import { describe, expect, it } from "vitest";

import { SG_STANDARD_CHARGES, splitReceipt, type SplitInput } from "@/domain";

import { createMockDb } from "./mock-client.test-helpers";
import { buildSaveSplitArgs, saveSplit, type ReceiptInput } from "./splits";

const HOST = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CARA = "33333333-3333-4333-8333-333333333333";

const SPLIT_INPUT: SplitInput = {
  items: [
    { label: "Chilli Crab", price: 8800, sharedBy: [HOST, "bob", "cara"] },
    { label: "Beer", price: 1200, sharedBy: [HOST, "bob"] },
  ],
  charges: SG_STANDARD_CHARGES,
  participants: [HOST, "bob", "cara"],
};

const RECEIPT: ReceiptInput = {
  title: "Jumbo",
  occurredAt: new Date("2026-03-01T12:00:00Z"),
  source: "llm",
  splitInput: SPLIT_INPUT,
  interpretation: { items: [], assumptions: ["x"] },
};

const FRIEND_MAP = { [HOST]: HOST, bob: BOB, cara: CARA };

describe("buildSaveSplitArgs", () => {
  const split = splitReceipt(SPLIT_INPUT);

  it("maps totals, charges and shares; the host share has friendId null", () => {
    const args = buildSaveSplitArgs(HOST, RECEIPT, split, FRIEND_MAP);
    expect(args.p_receipt).toMatchObject({
      hostId: HOST,
      title: "Jumbo",
      occurredAt: "2026-03-01T12:00:00.000Z",
      source: "llm",
      serviceChargeBps: 1000,
      gstBps: 900,
      subtotal: 10000,
      serviceCharge: 1000,
      gst: 990,
      total: 11990,
      interpretation: { items: [], assumptions: ["x"] },
      telegramChatId: null,
      recurringExpenseId: null,
      createdBy: "host",
    });
    const shares = args.p_shares as Array<{ friendId: string | null; amount: number }>;
    expect(shares.map((s) => s.friendId)).toEqual([null, BOB, CARA]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(11990);
    expect(shares.map((s) => s.amount)).toEqual(split.shares.map((s) => s.amount));
  });

  it("stores the split input as plain JSON (no remainder policy function)", () => {
    const withPolicy: ReceiptInput = { ...RECEIPT, splitInput: { ...SPLIT_INPUT, remainderPolicy: () => [] } };
    const args = buildSaveSplitArgs(HOST, withPolicy, split, FRIEND_MAP);
    const stored = (args.p_receipt as { splitInput: Record<string, unknown> }).splitInput;
    expect(stored).not.toHaveProperty("remainderPolicy");
    expect(stored).toMatchObject({ participants: [HOST, "bob", "cara"], charges: SG_STANDARD_CHARGES });
  });

  it("rejects unmapped participants and two participants mapped to one friend", () => {
    expect(() => buildSaveSplitArgs(HOST, RECEIPT, split, { [HOST]: HOST, bob: BOB })).toThrow(/cara is not mapped/);
    expect(() => buildSaveSplitArgs(HOST, RECEIPT, split, { [HOST]: HOST, bob: BOB, cara: BOB })).toThrow(/more than one/);
  });

  it("rejects a split whose shares do not add up to its total", () => {
    const broken = { ...split, totals: { ...split.totals, total: split.totals.total + 1 } };
    expect(() => buildSaveSplitArgs(HOST, RECEIPT, broken, FRIEND_MAP)).toThrow(/sum to/);
  });
});

describe("saveSplit", () => {
  it("calls the save_split RPC once and returns the receipt id", async () => {
    const { db, calls } = createMockDb([{ data: "receipt-1" }]);
    const id = await saveSplit(db, HOST, RECEIPT, splitReceipt(SPLIT_INPUT), FRIEND_MAP);
    expect(id).toBe("receipt-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].rpc).toBe("save_split");
    expect(calls[0].rpcArgs).toMatchObject({ p_receipt: { hostId: HOST } });
  });

  it("surfaces RPC failures as DbError and does nothing else", async () => {
    const { db, calls } = createMockDb([{ error: { message: "save_split: shares sum to 1 but the receipt total is 2", code: "23514" } }]);
    await expect(saveSplit(db, HOST, RECEIPT, splitReceipt(SPLIT_INPUT), FRIEND_MAP)).rejects.toMatchObject({
      name: "DbError",
      code: "23514",
    });
    expect(calls).toHaveLength(1);
  });
});
