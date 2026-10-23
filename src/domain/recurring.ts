import type { FriendId, Ledger } from "./balances";
import { appendEvent, creditOf, outstandingRequest } from "./balances";
import { NO_CHARGES } from "./charges";
import type { Cents } from "./money";
import { assertNonNegativeCents, MoneyError } from "./money";
import { hostNeverAbsorbs } from "./rounding";
import type { ParticipantId, ParticipantShare } from "./split";
import { splitReceipt } from "./split";
import { assertDate, daysInMonth, fromSgt, toSgt } from "./sgt";

/**
 * Recurring shared expenses (a shared subscription, the monthly cleaner,
 * ...): a split that repeats on a schedule and settles through the same
 * host ↔ friend ledger as one-off bills.
 */

export type RecurringCadence = "monthly" | "weekly";

export interface NextRunInput {
  readonly cadence: RecurringCadence;
  /** Monthly: day of month 1-31 (clamped to the month's last day). Weekly: 0 (Sun) - 6 (Sat). */
  readonly anchorDay: number;
  /** The run returned is strictly after this instant. */
  readonly from: Date;
}

export class RecurringError extends MoneyError {
  constructor(message: string) {
    super(message);
    this.name = "RecurringError";
  }
}

/** Recurring charges run at 09:00 Asia/Singapore. */
export const RECURRING_RUN_HOUR_SGT = 9;

function assertAnchorDay(cadence: RecurringCadence, anchorDay: number): number {
  const [min, max] = cadence === "monthly" ? [1, 31] : [0, 6];
  if (!Number.isSafeInteger(anchorDay) || anchorDay < min || anchorDay > max) {
    throw new RecurringError(`${cadence} anchorDay must be an integer ${min}-${max}, got ${String(anchorDay)}`);
  }
  return anchorDay;
}

/**
 * The first run strictly after `from`, at 09:00 Singapore time on the anchor
 * day. Monthly anchors past a month's end fall on its last day (31 -> 28/29
 * Feb, 30 Apr, ...); the following month returns to the anchor day.
 */
export function nextRunAt(input: NextRunInput): Date {
  const from = assertDate(input.from, "from");
  if (input.cadence !== "monthly" && input.cadence !== "weekly") {
    throw new RecurringError(`cadence must be "monthly" or "weekly", got ${String(input.cadence)}`);
  }
  const anchorDay = assertAnchorDay(input.cadence, input.anchorDay);
  const sgt = toSgt(from);

  if (input.cadence === "weekly") {
    const daysAhead = (anchorDay - sgt.weekday + 7) % 7;
    const candidate = fromSgt(sgt.year, sgt.month, sgt.day + daysAhead, RECURRING_RUN_HOUR_SGT);
    if (candidate.getTime() > from.getTime()) return candidate;
    return fromSgt(sgt.year, sgt.month, sgt.day + daysAhead + 7, RECURRING_RUN_HOUR_SGT);
  }

  let { year, month } = sgt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const day = Math.min(anchorDay, daysInMonth(year, month));
    const candidate = fromSgt(year, month, day, RECURRING_RUN_HOUR_SGT);
    if (candidate.getTime() > from.getTime()) return candidate;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  throw new RecurringError("unreachable: no monthly run found within two months");
}

export interface RecurringParticipant {
  readonly id: ParticipantId;
  /** Relative share, a positive integer (1 for an equal split). */
  readonly weight: number;
}

export interface RecurringChargeInput {
  /** The full recurring amount in cents (no service charge or GST on top). */
  readonly amount: Cents;
  readonly participants: readonly RecurringParticipant[];
  /** The participant who pays the provider; never absorbs rounding cents. */
  readonly hostId: ParticipantId;
}

/**
 * Splits one occurrence of a recurring expense by weight. Shares sum exactly
 * to `amount`; leftover cents go to friends, never to the host.
 */
export function recurringCharge(input: RecurringChargeInput): readonly ParticipantShare[] {
  assertNonNegativeCents(input.amount, "amount");
  if (!Array.isArray(input.participants) || input.participants.length === 0) {
    throw new RecurringError("participants must list at least one participant");
  }
  if (typeof input.hostId !== "string" || input.hostId.length === 0) {
    throw new RecurringError("hostId must be a non-empty participant id");
  }
  const ids = input.participants.map((participant) => participant.id);
  const weights = Object.fromEntries(input.participants.map((participant) => [participant.id, participant.weight]));
  const { shares, totals } = splitReceipt({
    participants: ids,
    charges: NO_CHARGES,
    items: [{ label: "Recurring share", price: input.amount, sharedBy: ids, weights }],
    remainderPolicy: hostNeverAbsorbs(input.hostId),
  });
  if (totals.total !== input.amount) {
    throw new RecurringError(`recurring charge total ${totals.total} does not match amount ${input.amount}`);
  }
  return shares;
}

/**
 * Records one occurrence against the ledger: an `expense_share` for every
 * participant except the host (who paid the provider). `ref` ties the
 * events back to the recurring expense and run.
 */
export function applyRecurringCharge(
  ledger: Ledger,
  shares: readonly ParticipantShare[],
  hostId: ParticipantId,
  ref?: string,
): Ledger {
  let next = ledger;
  for (const share of shares) {
    if (share.participantId === hostId) continue;
    next = appendEvent(next, { type: "expense_share", friendId: share.participantId, amount: share.amount, ref });
  }
  return next;
}

/** How much the friend must pay the host now that their share is on the ledger (credit already netted off). */
export function topUpNeeded(ledger: Ledger, friendId: FriendId): Cents {
  return outstandingRequest(ledger, friendId);
}

/** True when the friend's credit with the host is at least `amount`, i.e. the next charge needs no payment. */
export function creditCovers(ledger: Ledger, friendId: FriendId, amount: Cents): boolean {
  assertNonNegativeCents(amount, "amount");
  return creditOf(ledger, friendId) >= amount;
}
