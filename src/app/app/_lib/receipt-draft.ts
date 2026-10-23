import {
  hostNeverAbsorbs,
  MoneyError,
  NO_CHARGES,
  SG_GST_ONLY,
  SG_STANDARD_CHARGES,
  splitReceipt,
  type ChargePolicy,
  type ExclusionRedistribution,
  type ParticipantId,
  type SplitInput,
  type SplitResult,
} from "@/domain";

/**
 * The receipt being logged, as edited on the client. Pure data: the domain
 * recomputes money from it every time (`computeDraft`), and the server
 * recomputes once more on save. Nothing from the LLM is ever money.
 */
export interface DraftItem {
  readonly id: string;
  readonly label: string;
  /** Cents, >= 0. */
  readonly price: number;
  readonly sharedBy: readonly ParticipantId[];
  readonly weights?: Readonly<Record<ParticipantId, number>>;
}

export type ChargeChoice = "sc_gst" | "gst" | "none";

export const CHARGE_POLICIES: Readonly<Record<ChargeChoice, ChargePolicy>> = {
  sc_gst: SG_STANDARD_CHARGES,
  gst: SG_GST_ONLY,
  none: NO_CHARGES,
};

export const CHARGE_LABELS: Readonly<Record<ChargeChoice, string>> = {
  sc_gst: "10% service charge + 9% GST",
  gst: "9% GST only",
  none: "No charges (prices as paid)",
};

export function chargeChoiceFor(policy: ChargePolicy): ChargeChoice {
  if (policy.serviceChargeBps > 0) return "sc_gst";
  if (policy.gstBps > 0) return "gst";
  return "none";
}

export interface DraftParticipant {
  readonly id: ParticipantId;
  readonly name: string;
  readonly isHost: boolean;
}

export interface ReceiptDraft {
  readonly title: string;
  readonly source: "manual" | "llm";
  readonly participants: readonly DraftParticipant[];
  readonly items: readonly DraftItem[];
  readonly charges: ChargeChoice;
  readonly excluded: readonly ParticipantId[];
  readonly redistribute: ExclusionRedistribution;
  readonly treatedBy: ParticipantId | null;
  /** The LLM's words, shown as quotes. Never used for maths. */
  readonly assumptions: readonly string[];
  readonly questions: readonly string[];
  readonly warnings: readonly string[];
  /** Questions the host has ticked as handled. */
  readonly acknowledged: readonly number[];
  /** The raw interpretation, stored for audit only. */
  readonly interpretation?: unknown;
}

let counter = 0;
export function newItemId(): string {
  counter += 1;
  return `item-${Date.now().toString(36)}-${counter}`;
}

export function emptyDraft(participants: readonly DraftParticipant[], source: ReceiptDraft["source"]): ReceiptDraft {
  return {
    title: "",
    source,
    participants,
    items: [],
    charges: "sc_gst",
    excluded: [],
    redistribute: "proportional",
    treatedBy: null,
    assumptions: [],
    questions: [],
    warnings: [],
    acknowledged: [],
  };
}

/** Builds the domain input. The host never absorbs rounding. */
export function draftToSplitInput(draft: ReceiptDraft, hostId: string): SplitInput {
  const items = draft.items.map((item) => ({
    label: item.label,
    price: item.price,
    sharedBy: item.sharedBy,
    ...(item.weights ? { weights: item.weights } : {}),
  }));
  return {
    items,
    charges: CHARGE_POLICIES[draft.charges],
    participants: draft.participants.map((p) => p.id),
    remainderPolicy: hostNeverAbsorbs(hostId),
    ...(draft.excluded.length > 0 ? { exclusion: { participants: draft.excluded, redistribute: draft.redistribute } } : {}),
    ...(draft.treatedBy ? { treatedBy: draft.treatedBy } : {}),
  };
}

export type DraftComputation = { readonly ok: true; readonly split: SplitResult } | { readonly ok: false; readonly error: string };

/** Runs the domain on the draft. Any domain error becomes a message the host can act on. */
export function computeDraft(draft: ReceiptDraft, hostId: string): DraftComputation {
  if (draft.items.length === 0) return { ok: false, error: "Add at least one item." };
  try {
    return { ok: true, split: splitReceipt(draftToSplitInput(draft, hostId)) };
  } catch (error) {
    if (error instanceof MoneyError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Every reason Confirm is disabled, in display order. Empty means the host can confirm. */
export function confirmBlockers(draft: ReceiptDraft, computation: DraftComputation): string[] {
  const reasons: string[] = [];
  if (!computation.ok) reasons.push(computation.error);
  const unresolved = draft.questions.filter((_, i) => !draft.acknowledged.includes(i)).length;
  if (unresolved > 0) {
    reasons.push(`${unresolved} open ${unresolved === 1 ? "question" : "questions"} from the interpretation. Tick each one once you have checked it.`);
  }
  const unshared = draft.items.filter((item) => item.sharedBy.length === 0);
  if (unshared.length > 0) {
    reasons.push(`${unshared.length} ${unshared.length === 1 ? "item has" : "items have"} nobody sharing it.`);
  }
  if (draft.title.trim().length === 0) reasons.push("Give the receipt a title.");
  return reasons;
}

/** What gets POSTed to the server on Confirm; the server recomputes money from it. */
export interface SaveReceiptPayload {
  readonly title: string;
  readonly source: "manual" | "llm";
  readonly participantIds: readonly ParticipantId[];
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly price: number;
    readonly sharedBy: readonly ParticipantId[];
    readonly weights?: Readonly<Record<ParticipantId, number>>;
  }>;
  readonly charges: ChargeChoice;
  readonly excluded: readonly ParticipantId[];
  readonly redistribute: ExclusionRedistribution;
  readonly treatedBy: ParticipantId | null;
  readonly interpretation?: unknown;
  /** The total the host saw; the server refuses to save if it computes something else. */
  readonly expectedTotal: number;
  /** Linked Telegram group to post the split to after saving; omitted/null = no post. */
  readonly telegramChatId?: number | null;
}

export function toSavePayload(draft: ReceiptDraft, split: SplitResult): SaveReceiptPayload {
  return {
    title: draft.title.trim(),
    source: draft.source,
    participantIds: draft.participants.map((p) => p.id),
    items: draft.items.map(({ label, price, sharedBy, weights }) => ({ label, price, sharedBy, ...(weights ? { weights } : {}) })),
    charges: draft.charges,
    excluded: draft.excluded,
    redistribute: draft.redistribute,
    treatedBy: draft.treatedBy,
    ...(draft.interpretation !== undefined ? { interpretation: draft.interpretation } : {}),
    expectedTotal: split.totals.total,
  };
}

/** The subset of `/api/interpret`'s 200 body the client uses. */
export interface InterpretResponse {
  readonly interpretation: {
    readonly assumptions: readonly string[];
    readonly questions: readonly string[];
  };
  readonly splitInput: SplitInput;
  readonly warnings: readonly string[];
}

/** Turns the LLM proposal into an editable draft. Prices are the server's cents, never re-derived here. */
export function draftFromInterpretation(
  response: InterpretResponse,
  participants: readonly DraftParticipant[],
  title: string,
): ReceiptDraft {
  const { splitInput } = response;
  return {
    title,
    source: "llm",
    participants,
    items: splitInput.items.map((item) => ({
      id: newItemId(),
      label: item.label ?? "",
      price: item.price,
      sharedBy: item.sharedBy,
      ...(item.weights ? { weights: item.weights } : {}),
    })),
    charges: chargeChoiceFor(splitInput.charges),
    excluded: splitInput.exclusion?.participants ?? [],
    redistribute: splitInput.exclusion?.redistribute ?? "proportional",
    treatedBy: splitInput.treatedBy ?? null,
    assumptions: response.interpretation.assumptions,
    questions: response.interpretation.questions,
    warnings: response.warnings,
    acknowledged: [],
    interpretation: response.interpretation,
  };
}
