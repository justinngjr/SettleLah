import { beforeEach, describe, expect, it, vi } from "vitest";

import { splitReceipt } from "@/domain";

const HOST = "host-1";
const db = { tag: "db" };

const mocks = vi.hoisted(() => ({
  requireHost: vi.fn(),
  listFriends: vi.fn(),
  saveSplit: vi.fn(),
  refreshPaymentRequests: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../_lib/host", () => ({ requireHost: mocks.requireHost }));
vi.mock("../../_lib/payment-requests", () => ({ refreshPaymentRequests: mocks.refreshPaymentRequests }));
vi.mock("@/server/db", () => ({ listFriends: mocks.listFriends, saveSplit: mocks.saveSplit }));

import { saveReceipt } from "../receipts";

const payload = {
  title: "Dinner",
  source: "manual" as const,
  participantIds: [HOST, "f-sarah", "f-ben"],
  items: [
    { label: "Rice", price: 1000, sharedBy: [HOST, "f-sarah", "f-ben"] },
    { label: "Tea", price: 400, sharedBy: ["f-ben"] },
  ],
  charges: "none" as const,
  excluded: [],
  redistribute: "proportional" as const,
  treatedBy: null,
  expectedTotal: 1400,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHost.mockResolvedValue({ host: { id: HOST }, db });
  mocks.listFriends.mockResolvedValue([{ id: "f-sarah" }, { id: "f-ben" }]);
  mocks.saveSplit.mockResolvedValue("receipt-1");
  mocks.refreshPaymentRequests.mockResolvedValue(undefined);
});

describe("saveReceipt", () => {
  it("recomputes with hostNeverAbsorbs, saves atomically and refreshes requests for owing friends only", async () => {
    const result = await saveReceipt(payload);
    expect(result).toEqual({ ok: true, receiptId: "receipt-1" });

    const [dbArg, hostArg, receipt, split, friendMap] = mocks.saveSplit.mock.calls[0];
    expect(dbArg).toBe(db);
    expect(hostArg).toBe(HOST);
    expect(receipt).toMatchObject({ title: "Dinner", source: "manual" });
    expect(split).toEqual(splitReceipt(receipt.splitInput));
    // Host takes 333, friends 333 + 334 (+400 tea for Ben): the host never absorbs the cent.
    expect(split.shares.find((s: { participantId: string }) => s.participantId === HOST).amount).toBe(333);
    expect(friendMap).toEqual({ [HOST]: HOST, "f-sarah": "f-sarah", "f-ben": "f-ben" });
    expect(mocks.refreshPaymentRequests).toHaveBeenCalledWith(db, HOST, ["f-sarah", "f-ben"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("refuses when the client's total disagrees with the server's", async () => {
    const result = await saveReceipt({ ...payload, expectedTotal: 1399 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/total changed/i) });
    expect(mocks.saveSplit).not.toHaveBeenCalled();
  });

  it("refuses unknown participants and malformed payloads", async () => {
    expect(await saveReceipt({ ...payload, participantIds: [HOST, "stranger"], items: [{ label: "X", price: 100, sharedBy: ["stranger"] }], expectedTotal: 100 })).toMatchObject({ ok: false });
    expect(await saveReceipt({ ...payload, items: [] })).toMatchObject({ ok: false });
    expect(await saveReceipt({ ...payload, participantIds: ["f-sarah"] })).toMatchObject({ ok: false, error: expect.stringMatching(/participants/) });
    expect(mocks.saveSplit).not.toHaveBeenCalled();
  });

  it("does not open requests for a treated receipt (nobody owes)", async () => {
    const treated = { ...payload, treatedBy: HOST };
    const result = await saveReceipt(treated);
    expect(result).toMatchObject({ ok: true });
    expect(mocks.refreshPaymentRequests).toHaveBeenCalledWith(db, HOST, []);
  });

  it("returns an error (nothing saved) when saveSplit fails", async () => {
    mocks.saveSplit.mockRejectedValue(new Error("rpc down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveReceipt(payload)).toMatchObject({ ok: false });
    expect(mocks.refreshPaymentRequests).not.toHaveBeenCalled();
  });
});
