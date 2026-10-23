import type { LlmCaller, LlmCompletion, LlmRequest } from "./client";
import type { InterpretInput, ReceiptInterpretation } from "./schema";

export const PARTICIPANTS = [
  { id: "alice", name: "Alice" },
  { id: "ben", name: "Ben" },
  { id: "sarah", name: "Sarah" },
  { id: "dan", name: "Dan" },
  { id: "mei", name: "Mei" },
] as const;

export const ALL_IDS = PARTICIPANTS.map((p) => p.id);
export const NOT_SARAH = ALL_IDS.filter((id) => id !== "sarah");

/** Typical "++" seafood dinner. Subtotal $164.00, SC $16.40, GST $16.24, total $196.64. */
export const DINNER_RECEIPT_TEXT = `JUMBO SEAFOOD
Chilli Crab            88.00
Cereal Prawns          28.00
Rice x5                 6.00
Lime Juice x4          18.00
Tiger Beer x2          24.00
Subtotal              164.00
Svc Chg 10%            16.40
GST 9%                 16.24
TOTAL                 196.64`;

export const DINNER_INPUT: InterpretInput = {
  receiptText: DINNER_RECEIPT_TEXT,
  note: "Sarah skipped the drinks",
  participants: [...PARTICIPANTS],
};

/** What a well-behaved model returns for DINNER_INPUT. */
export const DINNER_INTERPRETATION: ReceiptInterpretation = {
  items: [
    { label: "Chilli Crab", price: "88.00", sharedBy: ALL_IDS },
    { label: "Cereal Prawns", price: "28.00", sharedBy: ALL_IDS },
    { label: "Rice x5", price: "6.00", sharedBy: ALL_IDS },
    { label: "Lime Juice x4", price: "18.00", sharedBy: NOT_SARAH },
    { label: "Tiger Beer x2", price: "24.00", sharedBy: NOT_SARAH },
  ],
  charges: { serviceCharge: true, gstInclusive: false },
  printed: { subtotal: "164.00", total: "196.64" },
  assumptions: ["Lime Juice and Tiger Beer are the drinks Sarah skipped."],
  questions: [],
};

export const DINNER_TOTALS = { subtotal: 16400, serviceCharge: 1640, gst: 1624, total: 19664 };

export type Step = (request: LlmRequest) => LlmCompletion | Promise<LlmCompletion>;

/** An `LlmCaller` that answers each call with the next step and records every request. */
export function scriptedLlm(steps: readonly Step[]): { llm: LlmCaller; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const llm: LlmCaller = {
    async complete(request) {
      requests.push(request);
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error(`unexpected LLM call #${requests.length}`);
      return step(request);
    },
  };
  return { llm, requests };
}

export const reply =
  (value: unknown): Step =>
  () => ({ text: typeof value === "string" ? value : JSON.stringify(value) });

export const lastUserText = (request: LlmRequest): string => {
  const last = request.messages[request.messages.length - 1];
  if (last.role !== "user") return "";
  return last.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
};
