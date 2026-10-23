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
  hostId: "alice",
};

/**
 * The orchestrator's live smoke-test case against SOCLaaS (both models agreed
 * on this interpretation). Subtotal $68.00, SC $6.80, GST $6.73, total $81.53.
 */
export const LIVE_PARTICIPANTS = [
  { id: "alex", name: "Alex" },
  { id: "ben", name: "Ben" },
  { id: "chloe", name: "Chloe" },
  { id: "dan", name: "Dan" },
  { id: "sarah", name: "Sarah" },
] as const;

export const LIVE_INPUT: InterpretInput = {
  receiptText: `2x Chicken Rice      12.00
1x Laksa              7.50
1x Crab Bee Hoon     36.00
3x Kopi               6.90
2x Lime Juice         5.60
Subtotal             68.00
Service Charge 10%    6.80
GST 9%                6.73
Total                81.53`,
  note: "Sarah skipped the drinks. Alex and Dan shared the crab. It's Ben's birthday, split his share equally.",
  participants: [...LIVE_PARTICIPANTS],
  hostId: "alex",
};

export const LIVE_INTERPRETATION: ReceiptInterpretation = {
  items: [
    { label: "2x Chicken Rice", price: "12.00", sharedBy: ["alex", "ben", "chloe", "dan", "sarah"] },
    { label: "1x Laksa", price: "7.50", sharedBy: ["alex", "ben", "chloe", "dan", "sarah"] },
    { label: "1x Crab Bee Hoon", price: "36.00", sharedBy: ["alex", "dan"] },
    { label: "3x Kopi", price: "6.90", sharedBy: ["alex", "ben", "chloe", "dan"] },
    { label: "2x Lime Juice", price: "5.60", sharedBy: ["alex", "ben", "chloe", "dan"] },
  ],
  charges: { serviceCharge: true, gstInclusive: false },
  exclusion: { participants: ["ben"], redistribute: "equal" },
  printed: { subtotal: "68.00", total: "81.53" },
  assumptions: ["Kopi and Lime Juice are the drinks Sarah skipped."],
  questions: [],
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
