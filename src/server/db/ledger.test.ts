import { describe, expect, it } from "vitest";

import { balanceOf } from "@/domain";

import { appendLedgerEvent, friendBalanceSql, listBalances, loadLedger, toLedgerEvent } from "./ledger";
import type { LedgerEventRow } from "./ledger";
import { argsOf, createMockDb } from "./mock-client.test-helpers";

function row(partial: Partial<LedgerEventRow>): LedgerEventRow {
  return {
    id: "e",
    host_id: "h1",
    friend_id: "cara",
    type: "expense_share",
    amount: 0,
    receipt_id: null,
    payment_request_id: null,
    bank_alert_id: null,
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "host",
    ...partial,
  };
}

/**
 * Same fixture as supabase/tests/04_payments_and_balances.sql, where SQL
 * `friend_balance` is asserted to be 457. The domain must agree.
 */
const SQL_FIXTURE: LedgerEventRow[] = [
  row({ id: "1", type: "expense_share", amount: 1000 }),
  row({ id: "2", type: "payment", amount: 400 }),
  row({ id: "3", type: "credit", amount: 100 }),
  row({ id: "4", type: "friend_fronted", amount: 50 }),
  row({ id: "5", type: "expense_share", amount: 7 }),
];
const SQL_FRIEND_BALANCE = 457;

describe("ledger repository", () => {
  it("maps rows to domain events, deriving ref from the source column", () => {
    expect(toLedgerEvent(row({ amount: 5, receipt_id: "r1", note: "dinner" }))).toEqual({
      type: "expense_share",
      friendId: "cara",
      amount: 5,
      note: "dinner",
      ref: "receipt:r1",
    });
    expect(toLedgerEvent(row({ type: "payment", amount: 5, payment_request_id: "p1" })).ref).toBe("payment_request:p1");
    expect(toLedgerEvent(row({ type: "credit", amount: 5 }))).toEqual({ type: "credit", friendId: "cara", amount: 5 });
  });

  it("rejects rows the domain would not accept", () => {
    expect(() => toLedgerEvent(row({ amount: -1 }))).toThrow(/must not be negative/);
    expect(() => toLedgerEvent(row({ amount: 1.5 }))).toThrow(/integer/);
  });

  it("domain balanceOf agrees with the SQL friend_balance fixture", async () => {
    const { db } = createMockDb([{ data: SQL_FIXTURE }]);
    const ledger = await loadLedger(db, "h1", "cara");
    expect(balanceOf(ledger, "cara")).toBe(SQL_FRIEND_BALANCE);
  });

  it("loadLedger filters by host and optionally friend, oldest first", async () => {
    const { db, calls } = createMockDb([{ data: [] }, { data: [] }]);
    await loadLedger(db, "h1");
    expect(calls[0].table).toBe("ledger_events");
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", "h1"]]);
    expect(argsOf(calls[0], "order")[0]).toEqual(["created_at", { ascending: true }]);
    await loadLedger(db, "h1", "cara");
    expect(argsOf(calls[1], "eq")).toEqual([
      ["host_id", "h1"],
      ["friend_id", "cara"],
    ]);
  });

  it("listBalances uses the domain and keeps archived friends only while unsettled", async () => {
    const friend = (id: string, archived: boolean) => ({
      id,
      host_id: "h1",
      display_name: id,
      telegram_user_id: null,
      telegram_username: null,
      private_chat_started: false,
      known_bank_names: [],
      archived,
      created_at: "",
      updated_at: "",
    });
    const { db } = createMockDb([
      { data: [friend("cara", false), friend("old-settled", true), friend("old-owing", true), friend("quiet", false)] },
      {
        data: [
          ...SQL_FIXTURE,
          row({ id: "6", friend_id: "old-owing", type: "expense_share", amount: 300 }),
          row({ id: "7", friend_id: "old-settled", type: "expense_share", amount: 300 }),
          row({ id: "8", friend_id: "old-settled", type: "payment", amount: 300 }),
        ],
      },
    ]);
    const balances = await listBalances(db, "h1");
    expect(balances.map((b) => [b.friend.id, b.balance])).toEqual([
      ["cara", 457],
      ["old-owing", 300],
      ["quiet", 0],
    ]);
  });

  it("friendBalanceSql calls the RPC with host and friend", async () => {
    const { db, calls } = createMockDb([{ data: 457 }]);
    expect(await friendBalanceSql(db, "h1", "cara")).toBe(457);
    expect(calls[0]).toMatchObject({ rpc: "friend_balance", rpcArgs: { p_host_id: "h1", p_friend_id: "cara" } });
  });

  it("appendLedgerEvent inserts a validated host-owned event", async () => {
    const { db, calls } = createMockDb([{ data: row({ type: "credit", amount: 250, note: "carry-over" }) }]);
    const event = await appendLedgerEvent(db, "h1", { friendId: "cara", type: "credit", amount: 250, note: "carry-over" });
    expect(event).toEqual({ type: "credit", friendId: "cara", amount: 250, note: "carry-over" });
    expect(argsOf(calls[0], "insert")[0][0]).toEqual({
      host_id: "h1",
      friend_id: "cara",
      type: "credit",
      amount: 250,
      note: "carry-over",
      created_by: "host",
    });
    await expect(appendLedgerEvent(db, "h1", { friendId: "cara", type: "credit", amount: -1 })).rejects.toThrow();
  });
});
