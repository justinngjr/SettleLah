import { describe, expect, it } from "vitest";

import { DbError } from "./errors";
import { argsOf, chainOf, createMockDb } from "./mock-client.test-helpers";
import {
  createRecurring,
  deleteRecurring,
  listDueRecurring,
  listRecurring,
  parseParticipants,
  pauseRecurring,
  RecurringInputError,
  resumeRecurring,
  runRecurringExpense,
  toRecurringExpense,
  updateRecurring,
  type RecurringExpenseRow,
} from "./recurring";

const HOST = "h1";
const NOW = new Date("2026-01-15T04:00:00Z"); // 12:00 SGT, 15 Jan

const ROW: RecurringExpenseRow = {
  id: "r1",
  host_id: HOST,
  title: "Netflix",
  amount: 1790,
  cadence: "monthly",
  anchor_day: 31,
  participants: [{ id: HOST, weight: 1 }, { id: "f1", weight: 2 }],
  service_charge_bps: 0,
  gst_bps: 0,
  telegram_chat_id: null,
  next_run_at: "2026-01-31T01:00:00Z",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("recurring repository", () => {
  it("maps rows and tolerates malformed participant JSON", () => {
    expect(toRecurringExpense(ROW)).toMatchObject({
      id: "r1",
      hostId: HOST,
      amount: 1790,
      cadence: "monthly",
      anchorDay: 31,
      participants: [
        { id: HOST, weight: 1 },
        { id: "f1", weight: 2 },
      ],
      telegramChatId: null,
      active: true,
    });
    expect(parseParticipants("nope")).toEqual([]);
    expect(parseParticipants([{ id: "a" }, { id: 3 }, null, { id: "b", weight: -1 }])).toEqual([
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ]);
  });

  it("listRecurring scopes by host, optionally active only", async () => {
    const { db, calls } = createMockDb([{ data: [ROW] }, { data: [] }]);
    const all = await listRecurring(db, HOST);
    expect(all.map((e) => e.title)).toEqual(["Netflix"]);
    expect(calls[0].table).toBe("recurring_expenses");
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", HOST]]);
    await listRecurring(db, HOST, { activeOnly: true });
    expect(argsOf(calls[1], "eq")).toEqual([
      ["host_id", HOST],
      ["active", true],
    ]);
  });

  it("createRecurring validates, checks friend ownership and schedules the first run at 09:00 SGT", async () => {
    const { db, calls } = createMockDb([{ data: [{ id: "f1" }] }, { data: ROW }]);
    await createRecurring(
      db,
      HOST,
      { title: "  Netflix ", amount: 1790, cadence: "monthly", anchorDay: 31, participants: [{ id: HOST, weight: 1 }, { id: "f1", weight: 2 }] },
      { now: NOW },
    );
    expect(calls[0].table).toBe("friends");
    expect(argsOf(calls[0], "eq")).toEqual([
      ["host_id", HOST],
      ["archived", false],
    ]);
    expect(argsOf(calls[0], "in")).toEqual([["id", ["f1"]]]);
    expect(calls[1].table).toBe("recurring_expenses");
    const [insert] = argsOf(calls[1], "insert")[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      host_id: HOST,
      title: "Netflix",
      amount: 1790,
      cadence: "monthly",
      anchor_day: 31,
      participants: [
        { id: HOST, weight: 1 },
        { id: "f1", weight: 2 },
      ],
      telegram_chat_id: null,
      active: true,
      next_run_at: "2026-01-31T01:00:00.000Z",
    });
  });

  it("createRecurring rejects bad input before touching the database", async () => {
    const { db, calls } = createMockDb();
    const base = { title: "Gym", amount: 1000, cadence: "weekly" as const, anchorDay: 1, participants: [{ id: "f1", weight: 1 }] };
    await expect(createRecurring(db, HOST, { ...base, title: " " })).rejects.toBeInstanceOf(RecurringInputError);
    await expect(createRecurring(db, HOST, { ...base, amount: 0 })).rejects.toThrow(/Amount/);
    await expect(createRecurring(db, HOST, { ...base, amount: 10.5 })).rejects.toThrow(/Amount/);
    await expect(createRecurring(db, HOST, { ...base, anchorDay: 7 })).rejects.toThrow(/Day of week/);
    await expect(createRecurring(db, HOST, { ...base, cadence: "monthly", anchorDay: 0 })).rejects.toThrow(/Day of month/);
    await expect(createRecurring(db, HOST, { ...base, participants: [] })).rejects.toThrow(/Participants/);
    await expect(createRecurring(db, HOST, { ...base, participants: [{ id: "f1", weight: 0 }] })).rejects.toThrow(/Weights/);
    await expect(createRecurring(db, HOST, { ...base, participants: [{ id: "f1", weight: 1 }, { id: "f1", weight: 1 }] })).rejects.toThrow(/once/);
    expect(calls).toHaveLength(0);
  });

  it("createRecurring refuses friends of another host and unlinked Telegram groups", async () => {
    const { db } = createMockDb([{ data: [] }]);
    await expect(
      createRecurring(db, HOST, { title: "Gym", amount: 1000, cadence: "weekly", anchorDay: 1, participants: [{ id: "stranger", weight: 1 }] }),
    ).rejects.toThrow(/friends list/);

    const { db: db2, calls } = createMockDb([{ data: [{ id: "f1" }] }, { data: null }]);
    await expect(
      createRecurring(db2, HOST, { title: "Gym", amount: 1000, cadence: "weekly", anchorDay: 1, participants: [{ id: "f1", weight: 1 }], telegramChatId: -5 }),
    ).rejects.toThrow(/Telegram group/);
    expect(calls[1].table).toBe("telegram_chats");
    expect(argsOf(calls[1], "eq")).toEqual([
      ["host_id", HOST],
      ["telegram_chat_id", -5],
    ]);
  });

  it("updateRecurring reschedules only when the cadence or anchor changes", async () => {
    const { db, calls } = createMockDb([{ data: ROW }, { data: { ...ROW, title: "Netflix 4K" } }]);
    await updateRecurring(db, HOST, "r1", { title: "Netflix 4K" }, { now: NOW });
    const [patch] = argsOf(calls[1], "update")[0] as [Record<string, unknown>];
    expect(patch).toEqual({ title: "Netflix 4K" });
    expect(argsOf(calls[1], "eq")).toEqual([
      ["host_id", HOST],
      ["id", "r1"],
    ]);

    const { db: db2, calls: calls2 } = createMockDb([{ data: ROW }, { data: { ...ROW, cadence: "weekly", anchor_day: 1 } }]);
    await updateRecurring(db2, HOST, "r1", { cadence: "weekly", anchorDay: 1 }, { now: NOW });
    const [patch2] = argsOf(calls2[1], "update")[0] as [Record<string, unknown>];
    // 15 Jan 2026 is a Thursday; next Monday 09:00 SGT is 19 Jan 01:00Z.
    expect(patch2).toEqual({ cadence: "weekly", anchor_day: 1, next_run_at: "2026-01-19T01:00:00.000Z" });
  });

  it("updateRecurring fails clearly when the expense is not the host's", async () => {
    const { db } = createMockDb([{ data: null }]);
    await expect(updateRecurring(db, HOST, "r-other", { title: "x" })).rejects.toBeInstanceOf(DbError);
  });

  it("pause stops runs; resume reschedules from now rather than back-charging", async () => {
    const { db, calls } = createMockDb([{ data: { ...ROW, active: false } }]);
    const paused = await pauseRecurring(db, HOST, "r1");
    expect(paused.active).toBe(false);
    expect(argsOf(calls[0], "update")).toEqual([[{ active: false }]]);
    expect(argsOf(calls[0], "eq")).toEqual([
      ["host_id", HOST],
      ["id", "r1"],
    ]);

    const { db: db2, calls: calls2 } = createMockDb([{ data: { ...ROW, active: false, next_run_at: "2025-06-30T01:00:00Z" } }, { data: ROW }]);
    await resumeRecurring(db2, HOST, "r1", { now: NOW });
    expect(argsOf(calls2[1], "update")).toEqual([[{ active: true, next_run_at: "2026-01-31T01:00:00.000Z" }]]);
  });

  it("deleteRecurring refuses once the expense has runs", async () => {
    const { db, calls } = createMockDb([{ data: [{ id: "run1", host_id: HOST, recurring_expense_id: "r1", period_key: "2026-01", receipt_id: null, ran_at: "x" }] }]);
    await expect(deleteRecurring(db, HOST, "r1")).rejects.toThrow(/pause it instead/);
    expect(calls).toHaveLength(1);

    const { db: db2, calls: calls2 } = createMockDb([{ data: [] }, { data: null }]);
    await deleteRecurring(db2, HOST, "r1");
    expect(chainOf(calls2[1])).toContain("delete");
    expect(argsOf(calls2[1], "eq")).toEqual([
      ["host_id", HOST],
      ["id", "r1"],
    ]);
  });

  it("listDueRecurring is the one cross-host query: active and next_run_at <= now", async () => {
    const { db, calls } = createMockDb([{ data: [ROW] }]);
    await listDueRecurring(db, NOW);
    expect(argsOf(calls[0], "eq")).toEqual([["active", true]]);
    expect(argsOf(calls[0], "lte")).toEqual([["next_run_at", NOW.toISOString()]]);
  });

  it("runRecurringExpense calls the atomic RPC and refuses a receipt for another host", async () => {
    const { db, calls } = createMockDb([{ data: "receipt-1" }]);
    const receipt = { hostId: HOST, title: "Netflix" };
    const id = await runRecurringExpense(db, HOST, { recurringExpenseId: "r1", periodKey: "2026-01", receipt, shares: [], nextRunAt: NOW });
    expect(id).toBe("receipt-1");
    expect(calls[0].rpc).toBe("run_recurring_expense");
    expect(calls[0].rpcArgs).toEqual({
      p_recurring_expense_id: "r1",
      p_period_key: "2026-01",
      p_receipt: receipt,
      p_shares: [],
      p_next_run_at: NOW.toISOString(),
    });
    await expect(
      runRecurringExpense(db, HOST, { recurringExpenseId: "r1", periodKey: "2026-01", receipt: { hostId: "h2" }, shares: [], nextRunAt: NOW }),
    ).rejects.toBeInstanceOf(DbError);
  });
});
