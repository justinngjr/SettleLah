import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecurringExpense } from "@/server/db";

const mocks = vi.hoisted(() => ({
  listDueRecurring: vi.fn(),
  listFriends: vi.fn(),
  runRecurringExpense: vi.fn(),
  refreshPaymentRequests: vi.fn(),
}));

vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  return {
    ...actual,
    listDueRecurring: mocks.listDueRecurring,
    listFriends: mocks.listFriends,
    runRecurringExpense: mocks.runRecurringExpense,
  };
});
vi.mock("@/server/payments/refresh", () => ({ refreshPaymentRequests: mocks.refreshPaymentRequests }));

import { periodKeyFor, recurringSplit, runDueRecurring } from "./runner";

const HOST = "11111111-1111-1111-1111-111111111111";
const SARAH = "22222222-2222-2222-2222-222222222222";
const BEN = "33333333-3333-3333-3333-333333333333";
const db = { tag: "service-db" } as never;

function expense(patch: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    hostId: HOST,
    title: "Netflix",
    amount: 1790,
    cadence: "monthly",
    anchorDay: 31,
    participants: [
      { id: HOST, weight: 1 },
      { id: SARAH, weight: 1 },
      { id: BEN, weight: 1 },
    ],
    telegramChatId: null,
    // 09:00 SGT on 31 Jan 2026 = 01:00Z
    nextRunAt: "2026-01-31T01:00:00.000Z",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

const NOW = new Date("2026-01-31T01:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listFriends.mockResolvedValue([{ id: SARAH }, { id: BEN }]);
  mocks.runRecurringExpense.mockResolvedValue("receipt-1");
  mocks.refreshPaymentRequests.mockResolvedValue(undefined);
});

describe("periodKeyFor", () => {
  it("keys monthly runs by Singapore month and weekly runs by Singapore date", () => {
    // 2026-01-31T16:30Z is already 1 Feb in Singapore.
    expect(periodKeyFor("monthly", new Date("2026-01-31T16:30:00Z"))).toBe("2026-02");
    expect(periodKeyFor("monthly", new Date("2026-01-31T01:00:00Z"))).toBe("2026-01");
    expect(periodKeyFor("weekly", new Date("2026-01-31T16:30:00Z"))).toBe("2026-02-01");
  });
});

describe("recurringSplit", () => {
  it("splits by weight with the host never absorbing the leftover cent", () => {
    const { split } = recurringSplit(expense({ amount: 1000, participants: [{ id: HOST, weight: 1 }, { id: SARAH, weight: 1 }, { id: BEN, weight: 1 }] }));
    const by = Object.fromEntries(split.shares.map((s) => [s.participantId, s.amount]));
    expect(by[HOST]).toBe(333);
    expect(by[SARAH] + by[BEN]).toBe(667);
    expect(split.totals.total).toBe(1000);
  });

  it("honours weights (a couple paying double)", () => {
    const { split } = recurringSplit(expense({ amount: 3000, participants: [{ id: HOST, weight: 1 }, { id: SARAH, weight: 2 }] }));
    const by = Object.fromEntries(split.shares.map((s) => [s.participantId, s.amount]));
    expect(by).toEqual({ [HOST]: 1000, [SARAH]: 2000 });
  });
});

describe("runDueRecurring", () => {
  it("charges each due expense through the atomic RPC and refreshes requests for the friends only", async () => {
    mocks.listDueRecurring.mockResolvedValue([expense()]);
    const summary = await runDueRecurring({ db, now: () => NOW });

    expect(mocks.listDueRecurring).toHaveBeenCalledWith(db, NOW);
    expect(mocks.runRecurringExpense).toHaveBeenCalledTimes(1);
    const [dbArg, hostArg, input] = mocks.runRecurringExpense.mock.calls[0];
    expect(dbArg).toBe(db);
    expect(hostArg).toBe(HOST);
    expect(input.recurringExpenseId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(input.periodKey).toBe("2026-01");
    expect(input.receipt).toMatchObject({
      hostId: HOST,
      title: "Netflix",
      source: "manual",
      total: 1790,
      recurringExpenseId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      createdBy: "system",
      occurredAt: "2026-01-31T01:00:00.000Z",
    });
    const shares = input.shares as { friendId: string | null; amount: number }[];
    expect(shares.find((s) => s.friendId === null)?.amount).toBe(596);
    expect(shares.filter((s) => s.friendId !== null).reduce((a, s) => a + s.amount, 0)).toBe(1194);
    expect(mocks.refreshPaymentRequests).toHaveBeenCalledWith(db, HOST, [SARAH, BEN]);
    expect(summary).toMatchObject({ due: 1, charged: 1, alreadyRan: 0, skipped: 0, failed: 0 });
  });

  it("advances next_run_at from the scheduled run, clamping month-end anchors (31 Jan -> 28 Feb -> 31 Mar)", async () => {
    mocks.listDueRecurring.mockResolvedValue([expense()]);
    await runDueRecurring({ db, now: () => NOW });
    const first = mocks.runRecurringExpense.mock.calls[0][2].nextRunAt as Date;
    expect(first.toISOString()).toBe("2026-02-28T01:00:00.000Z");

    mocks.listDueRecurring.mockResolvedValue([expense({ nextRunAt: first.toISOString() })]);
    await runDueRecurring({ db, now: () => new Date("2026-02-28T02:00:00Z") });
    const second = mocks.runRecurringExpense.mock.calls[1][2];
    expect(second.periodKey).toBe("2026-02");
    expect((second.nextRunAt as Date).toISOString()).toBe("2026-03-31T01:00:00.000Z");
  });

  it("is idempotent per period: a second run reports already_ran and touches no requests", async () => {
    mocks.listDueRecurring.mockResolvedValue([expense()]);
    mocks.runRecurringExpense.mockResolvedValueOnce("receipt-1").mockResolvedValueOnce(null);
    const first = await runDueRecurring({ db, now: () => NOW });
    const second = await runDueRecurring({ db, now: () => NOW });
    expect(first.charged).toBe(1);
    expect(second).toMatchObject({ charged: 0, alreadyRan: 1 });
    expect(mocks.runRecurringExpense.mock.calls[0][2].periodKey).toBe(mocks.runRecurringExpense.mock.calls[1][2].periodKey);
    expect(mocks.refreshPaymentRequests).toHaveBeenCalledTimes(1);
  });

  it("does nothing for paused expenses (they are never due)", async () => {
    mocks.listDueRecurring.mockResolvedValue([]);
    const summary = await runDueRecurring({ db, now: () => NOW });
    expect(summary).toMatchObject({ due: 0, charged: 0 });
    expect(mocks.runRecurringExpense).not.toHaveBeenCalled();
  });

  it("drops archived friends from the charge and skips when nobody but the host is left", async () => {
    mocks.listFriends.mockResolvedValue([{ id: SARAH }]);
    mocks.listDueRecurring.mockResolvedValue([expense()]);
    await runDueRecurring({ db, now: () => NOW });
    const shares = mocks.runRecurringExpense.mock.calls[0][2].shares as { friendId: string | null; amount: number }[];
    expect(shares.map((s) => s.friendId).sort()).toEqual([SARAH, null].sort());
    expect(mocks.refreshPaymentRequests).toHaveBeenCalledWith(db, HOST, [SARAH]);

    mocks.listFriends.mockResolvedValue([]);
    const summary = await runDueRecurring({ db, now: () => NOW });
    expect(summary.results[0]).toMatchObject({ status: "skipped" });
  });

  it("calls notify only when a group is linked, after the commit, and survives a failed post", async () => {
    const notify = vi.fn().mockResolvedValue({ messageId: 1 });
    mocks.listDueRecurring.mockResolvedValue([expense()]);
    await runDueRecurring({ db, now: () => NOW, notify });
    expect(notify).not.toHaveBeenCalled();

    mocks.listDueRecurring.mockResolvedValue([expense({ telegramChatId: -1001 })]);
    const linked = await runDueRecurring({ db, now: () => NOW, notify });
    expect(notify).toHaveBeenCalledWith({ hostId: HOST, receiptId: "receipt-1", telegramChatId: -1001 });
    expect(linked.results[0]).toMatchObject({ status: "charged", notified: true });

    notify.mockRejectedValueOnce(new Error("bot kicked"));
    const failed = await runDueRecurring({ db, now: () => NOW, notify });
    expect(failed.results[0]).toMatchObject({ status: "charged", notified: false, notifyError: "bot kicked" });
    expect(failed.failed).toBe(0);
  });

  it("does not notify for a period that already ran", async () => {
    const notify = vi.fn();
    mocks.listDueRecurring.mockResolvedValue([expense({ telegramChatId: -1001 })]);
    mocks.runRecurringExpense.mockResolvedValue(null);
    await runDueRecurring({ db, now: () => NOW, notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it("isolates failures: one broken expense does not stop the next host's", async () => {
    mocks.listDueRecurring.mockResolvedValue([expense(), expense({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", hostId: "other-host", participants: [{ id: "other-host", weight: 1 }, { id: "f-x", weight: 1 }] })]);
    mocks.listFriends.mockImplementation(async (_db: unknown, hostId: string) => (hostId === HOST ? [{ id: SARAH }, { id: BEN }] : [{ id: "f-x" }]));
    mocks.runRecurringExpense.mockRejectedValueOnce(new Error("deadlock")).mockResolvedValueOnce("receipt-2");
    const summary = await runDueRecurring({ db, now: () => NOW });
    expect(summary).toMatchObject({ due: 2, charged: 1, failed: 1 });
    expect(summary.results[0]).toMatchObject({ status: "failed", error: "deadlock" });
    expect(summary.results[1]).toMatchObject({ status: "charged", hostId: "other-host" });
  });
});
