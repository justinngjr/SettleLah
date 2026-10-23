import "server-only";

import type { Cents, Ledger, LedgerEvent, LedgerEventType } from "@/domain";
import { allBalances, assertLedgerEvent } from "@/domain";

import type { DbClient } from "./client";
import type { Enums, Tables, TablesInsert } from "./database.types";
import { unwrap, unwrapRequired } from "./errors";
import type { Friend } from "./friends";
import { listFriends } from "./friends";

export type LedgerEventRow = Tables<"ledger_events">;

/**
 * Maps a `ledger_events` row to the domain's `LedgerEvent`. The database
 * stores the same non-negative magnitude + type the domain uses, so the
 * domain's `signedAmount` is the only place a sign is ever applied.
 */
export function toLedgerEvent(row: LedgerEventRow): LedgerEvent {
  const ref = row.receipt_id
    ? `receipt:${row.receipt_id}`
    : row.payment_request_id
      ? `payment_request:${row.payment_request_id}`
      : row.bank_alert_id
        ? `bank_alert:${row.bank_alert_id}`
        : undefined;
  return assertLedgerEvent({
    type: row.type,
    friendId: row.friend_id,
    amount: row.amount,
    ...(row.note !== null ? { note: row.note } : {}),
    ...(ref !== undefined ? { ref } : {}),
  });
}

/**
 * Loads the host's raw ledger (optionally for one friend), oldest first, as a
 * domain `Ledger`. Balances are then computed by `src/domain/balances.ts`,
 * which is the source of truth; `friend_balance` in SQL is a convenience that
 * must agree with it (tested in supabase/tests/04_payments_and_balances.sql).
 */
export async function loadLedger(db: DbClient, hostId: string, friendId?: string): Promise<Ledger> {
  let query = db
    .from("ledger_events")
    .select("*")
    .eq("host_id", hostId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (friendId !== undefined) query = query.eq("friend_id", friendId);
  const rows = unwrap(await query, "loadLedger") ?? [];
  return rows.map(toLedgerEvent);
}

export interface FriendBalance {
  readonly friend: Friend;
  /** Positive = the friend owes the host; negative = the friend holds credit. */
  readonly balance: Cents;
}

/**
 * Balance for every active friend (zero if they have no events) plus any
 * archived friend whose balance is not yet settled. Computed with the domain.
 */
export async function listBalances(db: DbClient, hostId: string): Promise<FriendBalance[]> {
  const [friends, ledger] = await Promise.all([listFriends(db, hostId, { includeArchived: true }), loadLedger(db, hostId)]);
  const balances = allBalances(ledger);
  return friends
    .map((friend) => ({ friend, balance: balances.get(friend.id) ?? 0 }))
    .filter(({ friend, balance }) => !friend.archived || balance !== 0);
}

/** The SQL-side balance, for cross-checking against the domain. Not for display. */
export async function friendBalanceSql(db: DbClient, hostId: string, friendId: string): Promise<Cents> {
  const balance = unwrap(await db.rpc("friend_balance", { p_host_id: hostId, p_friend_id: friendId }), "friendBalanceSql");
  return balance ?? 0;
}

export interface NewLedgerEvent {
  readonly friendId: string;
  readonly type: Exclude<LedgerEventType, "expense_share" | "payment">;
  readonly amount: Cents;
  readonly note?: string;
  readonly createdBy?: Enums<"actor_type">;
}

/**
 * Appends a manual `credit` or `friend_fronted` event. `expense_share` events
 * only come from `saveSplit` and `payment` events only from confirming a
 * claim, so each is tied to its source row.
 */
export async function appendLedgerEvent(db: DbClient, hostId: string, event: NewLedgerEvent): Promise<LedgerEvent> {
  assertLedgerEvent({ type: event.type, friendId: event.friendId, amount: event.amount });
  const insert: TablesInsert<"ledger_events"> = {
    host_id: hostId,
    friend_id: event.friendId,
    type: event.type,
    amount: event.amount,
    note: event.note ?? null,
    created_by: event.createdBy ?? "host",
  };
  const row = unwrapRequired(await db.from("ledger_events").insert(insert).select("*").single(), "appendLedgerEvent");
  return toLedgerEvent(row);
}
