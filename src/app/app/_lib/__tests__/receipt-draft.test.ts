import { describe, expect, it } from "vitest";

import { SG_GST_ONLY, SG_STANDARD_CHARGES, splitReceipt } from "@/domain";

import {
  chargeChoiceFor,
  computeDraft,
  confirmBlockers,
  draftFromInterpretation,
  draftToSplitInput,
  emptyDraft,
  toSavePayload,
  type DraftParticipant,
  type ReceiptDraft,
} from "../receipt-draft";

const HOST = "host-1";
const participants: DraftParticipant[] = [
  { id: HOST, name: "Me", isHost: true },
  { id: "f-sarah", name: "Sarah", isHost: false },
  { id: "f-ben", name: "Ben", isHost: false },
];

function draftWith(items: ReceiptDraft["items"], patch: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return { ...emptyDraft(participants, "manual"), title: "Dinner", items, ...patch };
}

describe("computeDraft", () => {
  it("matches the domain's splitReceipt for the same input", () => {
    const draft = draftWith([
      { id: "a", label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah", "f-ben"] },
      { id: "b", label: "Tea", price: 333, sharedBy: ["f-sarah"] },
    ]);
    const result = computeDraft(draft, HOST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.split).toEqual(splitReceipt(draftToSplitInput(draft, HOST)));
    expect(result.split.totals.subtotal).toBe(1333);
    expect(result.split.shares.reduce((s, x) => s + x.amount, 0)).toBe(result.split.totals.total);
  });

  it("never gives the host the rounding remainder when a friend can take it", () => {
    const draft = draftWith([{ id: "a", label: "Shared", price: 1000, sharedBy: [HOST, "f-sarah", "f-ben"] }], { charges: "none" });
    const result = computeDraft(draft, HOST);
    if (!result.ok) throw new Error(result.error);
    const host = result.split.shares.find((s) => s.participantId === HOST)!;
    const others = result.split.shares.filter((s) => s.participantId !== HOST);
    expect(host.amount).toBe(333);
    expect(others.map((s) => s.amount).sort()).toEqual([333, 334]);
  });

  it("reports an empty receipt instead of throwing", () => {
    expect(computeDraft(draftWith([]), HOST)).toEqual({ ok: false, error: "Add at least one item." });
  });

  it("surfaces domain errors as messages", () => {
    const draft = draftWith([{ id: "a", label: "X", price: -1, sharedBy: ["f-sarah"] }]);
    const result = computeDraft(draft, HOST);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\S/);
  });
});

describe("confirmBlockers", () => {
  const good = draftWith([{ id: "a", label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah"] }]);

  it("is empty when everything is resolved", () => {
    expect(confirmBlockers(good, computeDraft(good, HOST))).toEqual([]);
  });

  it("blocks while any LLM question is unacknowledged, and clears once all are ticked", () => {
    const withQuestions = { ...good, questions: ["Who had the tea?", "Was there GST?"] };
    expect(confirmBlockers(withQuestions, computeDraft(withQuestions, HOST))).toEqual([
      expect.stringContaining("2 open questions"),
    ]);
    const half = { ...withQuestions, acknowledged: [0] };
    expect(confirmBlockers(half, computeDraft(half, HOST))).toEqual([expect.stringContaining("1 open question")]);
    const all = { ...withQuestions, acknowledged: [1, 0] };
    expect(confirmBlockers(all, computeDraft(all, HOST))).toEqual([]);
  });

  it("blocks when an item has nobody sharing it or the title is empty", () => {
    const draft = { ...good, title: " ", items: [{ id: "a", label: "Rice", price: 1000, sharedBy: [] }] };
    const blockers = confirmBlockers(draft, computeDraft(draft, HOST));
    expect(blockers.some((b) => /nobody sharing/.test(b))).toBe(true);
    expect(blockers).toContain("Give the receipt a title.");
  });
});

describe("draftFromInterpretation", () => {
  it("copies the server's cents and words; money is never re-derived", () => {
    const draft = draftFromInterpretation(
      {
        interpretation: { assumptions: ["Tea shared equally"], questions: ["Who had the cake?"] },
        splitInput: {
          items: [{ label: "Tea", price: 450, sharedBy: ["f-sarah", "f-ben"], weights: { "f-sarah": 2, "f-ben": 1 } }],
          charges: SG_GST_ONLY,
          participants: [HOST, "f-sarah", "f-ben"],
          exclusion: { participants: ["f-ben"], redistribute: "equal" },
        },
        warnings: ["Printed total 5.00 differs from computed 4.91"],
      },
      participants,
      "Cafe",
    );
    expect(draft.source).toBe("llm");
    expect(draft.items[0]).toMatchObject({ label: "Tea", price: 450, weights: { "f-sarah": 2, "f-ben": 1 } });
    expect(draft.charges).toBe("gst");
    expect(draft.excluded).toEqual(["f-ben"]);
    expect(draft.redistribute).toBe("equal");
    expect(draft.questions).toEqual(["Who had the cake?"]);
    expect(draft.warnings).toHaveLength(1);
    expect(draft.acknowledged).toEqual([]);
  });

  it("maps charge policies back to the editor's choices", () => {
    expect(chargeChoiceFor(SG_STANDARD_CHARGES)).toBe("sc_gst");
    expect(chargeChoiceFor(SG_GST_ONLY)).toBe("gst");
    expect(chargeChoiceFor({ serviceChargeBps: 0, gstBps: 0 })).toBe("none");
  });
});

describe("toSavePayload", () => {
  it("carries the computed total so the server can refuse a stale confirm", () => {
    const draft = draftWith([{ id: "a", label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah"] }], { charges: "sc_gst" });
    const result = computeDraft(draft, HOST);
    if (!result.ok) throw new Error(result.error);
    const payload = toSavePayload(draft, result.split);
    expect(payload.expectedTotal).toBe(result.split.totals.total);
    expect(payload.participantIds).toEqual([HOST, "f-sarah", "f-ben"]);
    expect(payload.items).toEqual([{ label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah"] }]);
  });
});
