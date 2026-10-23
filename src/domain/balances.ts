import type { Cents } from "./money";
import { assertNonNegativeCents, MoneyError } from "./money";

export type FriendId = string;

/**
 * Pairwise ledger between the host and one friend. Sign convention for the
 * balance: positive = the friend owes the host, negative = the host owes the
 * friend (the friend holds credit).
 *
 * - `expense_share`: the friend's share of a bill the host paid (+).
 * - `payment`: the friend paid the host (−). Paying more than owed simply
 *   drives the balance negative, i.e. becomes credit.
 * - `credit`: credit granted to the friend outside a payment, e.g. carried
 *   over from last month or a goodwill adjustment (−).
 * - `friend_fronted`: the friend paid for the host, offsetting what they owe (−).
 */
export type LedgerEventType = "expense_share" | "payment" | "credit" | "friend_fronted";

export interface LedgerEvent {
  readonly type: LedgerEventType;
  readonly friendId: FriendId;
  /** Always a non-negative magnitude; the sign comes from `type`. */
  readonly amount: Cents;
  readonly note?: string;
  /** Optional reference to the source (bill id, bank transaction id, ...). */
  readonly ref?: string;
}

export type Ledger = readonly LedgerEvent[];

const SIGN: Readonly<Record<LedgerEventType, 1 | -1>> = {
  expense_share: 1,
  payment: -1,
  credit: -1,
  friend_fronted: -1,
};

export function assertLedgerEvent(event: LedgerEvent): LedgerEvent {
  if (!Object.hasOwn(SIGN, event.type)) {
    throw new MoneyError(`unknown ledger event type ${String(event.type)}`);
  }
  if (typeof event.friendId !== "string" || event.friendId.length === 0) {
    throw new MoneyError("ledger event friendId must be a non-empty string");
  }
  assertNonNegativeCents(event.amount, `${event.type} amount`);
  return event;
}

/** Returns a new ledger with `event` appended (validated). The input is not mutated. */
export function appendEvent(ledger: Ledger, event: LedgerEvent): Ledger {
  return [...ledger, assertLedgerEvent(event)];
}

/** Signed effect of one event on the friend's balance. */
export function signedAmount(event: LedgerEvent): Cents {
  assertLedgerEvent(event);
  return SIGN[event.type] * event.amount;
}

/** Net balance: positive = friend owes host, negative = friend has credit. */
export function balanceOf(ledger: Ledger, friendId: FriendId): Cents {
  let balance = 0;
  for (const event of ledger) {
    if (event.friendId === friendId) {
      balance += signedAmount(event);
      if (!Number.isSafeInteger(balance)) {
        throw new MoneyError(`balance for ${friendId} overflows the safe integer range`);
      }
    }
  }
  return balance;
}

/**
 * What the host should actually ask the friend for right now: their balance
 * after any credit has been consumed, never negative.
 */
export function outstandingRequest(ledger: Ledger, friendId: FriendId): Cents {
  return Math.max(0, balanceOf(ledger, friendId));
}

/** Credit the friend currently holds with the host (the host owes them), never negative. */
export function creditOf(ledger: Ledger, friendId: FriendId): Cents {
  return Math.max(0, -balanceOf(ledger, friendId));
}

/** Balance for every friend that appears in the ledger, in order of first appearance. */
export function allBalances(ledger: Ledger): ReadonlyMap<FriendId, Cents> {
  const balances = new Map<FriendId, Cents>();
  for (const event of ledger) {
    const previous = balances.get(event.friendId) ?? 0;
    const next = previous + signedAmount(event);
    if (!Number.isSafeInteger(next)) {
      throw new MoneyError(`balance for ${event.friendId} overflows the safe integer range`);
    }
    balances.set(event.friendId, next);
  }
  return balances;
}
