import "server-only";

import { hostNeverAbsorbs, nextRunAt, NO_CHARGES, recurringCharge, toSgt, type RecurringCadence, type SplitResult } from "@/domain";
import {
  buildSaveSplitArgs,
  listDueRecurring,
  listFriends,
  runRecurringExpense,
  type DbClient,
  type FriendMap,
  type RecurringExpense,
} from "@/server/db";
import { refreshPaymentRequests } from "@/server/payments/refresh";

/**
 * The hourly recurring runner. A recurring expense is a split that repeats:
 * each due expense becomes an ordinary receipt (through `save_split`, so the
 * friends' `expense_share` events land on the same ledger and any credit they
 * hold is netted off), their payment requests are refreshed, and the split is
 * posted to the linked Telegram group when there is one. Friends who still
 * owe something after credit get the normal request + reminders.
 */

export interface NotifyRequest {
  readonly hostId: string;
  readonly receiptId: string;
  readonly telegramChatId: number;
}

export interface RecurringRunnerDeps {
  /** Service-role client: the runner spans every host. */
  readonly db: DbClient;
  readonly now?: () => Date;
  /** Posts a saved split to its Telegram group; undefined when Telegram is not configured. */
  readonly notify?: (input: NotifyRequest) => Promise<unknown>;
}

export type RecurringOutcome =
  | { readonly status: "charged"; readonly receiptId: string; readonly periodKey: string; readonly notified: boolean; readonly notifyError?: string }
  | { readonly status: "already_ran"; readonly periodKey: string }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "failed"; readonly error: string };

export interface RecurringRunSummary {
  readonly ranAt: string;
  readonly due: number;
  readonly charged: number;
  readonly alreadyRan: number;
  readonly skipped: number;
  readonly failed: number;
  readonly results: readonly ({ readonly recurringExpenseId: string; readonly hostId: string } & RecurringOutcome)[];
}

/**
 * The idempotency key for one scheduled occurrence: the Singapore calendar
 * month for monthly expenses, the Singapore run date for weekly ones. Two
 * runners racing on the same occurrence agree on the key and only one wins.
 */
export function periodKeyFor(cadence: RecurringCadence, scheduledAt: Date): string {
  const { year, month, day } = toSgt(scheduledAt);
  const ym = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return cadence === "monthly" ? ym : `${ym}-${String(day).padStart(2, "0")}`;
}

/** The split for one occurrence, shaped like a saved manual receipt with a single shared line. */
export function recurringSplit(expense: RecurringExpense) {
  const participants = expense.participants;
  const ids = participants.map((p) => p.id);
  const weights = Object.fromEntries(participants.map((p) => [p.id, p.weight]));
  const shares = recurringCharge({ amount: expense.amount, participants, hostId: expense.hostId });
  const split: SplitResult = {
    totals: { subtotal: expense.amount, serviceCharge: 0, gst: 0, total: expense.amount },
    shares,
  };
  const splitInput = {
    participants: ids,
    charges: NO_CHARGES,
    items: [{ label: expense.title, price: expense.amount, sharedBy: ids, weights }],
    remainderPolicy: hostNeverAbsorbs(expense.hostId),
  };
  return { split, splitInput };
}

async function runOne(deps: RecurringRunnerDeps, expense: RecurringExpense, now: Date): Promise<RecurringOutcome> {
  const scheduledAt = expense.nextRunAt ? new Date(expense.nextRunAt) : now;
  const periodKey = periodKeyFor(expense.cadence, scheduledAt);

  const friends = await listFriends(deps.db, expense.hostId);
  const friendIds = new Set(friends.map((f) => f.id));
  const live = expense.participants.filter((p) => p.id === expense.hostId || friendIds.has(p.id));
  if (live.length === 0 || live.every((p) => p.id === expense.hostId)) {
    return { status: "skipped", reason: "no active friends share this expense" };
  }

  const { split, splitInput } = recurringSplit({ ...expense, participants: live });
  const friendMap: FriendMap = Object.fromEntries(live.map((p) => [p.id, p.id]));
  const args = buildSaveSplitArgs(
    expense.hostId,
    {
      title: expense.title,
      occurredAt: scheduledAt,
      source: "manual",
      splitInput,
      recurringExpenseId: expense.id,
      telegramChatId: expense.telegramChatId,
      createdBy: "system",
    },
    split,
    friendMap,
  );
  const following = nextRunAt({ cadence: expense.cadence, anchorDay: expense.anchorDay, from: scheduledAt });

  const receiptId = await runRecurringExpense(deps.db, expense.hostId, {
    recurringExpenseId: expense.id,
    periodKey,
    receipt: args.p_receipt,
    shares: args.p_shares,
    nextRunAt: following,
  });
  if (receiptId === null) return { status: "already_ran", periodKey };

  await refreshPaymentRequests(
    deps.db,
    expense.hostId,
    live.filter((p) => p.id !== expense.hostId).map((p) => p.id),
  );

  if (expense.telegramChatId === null || !deps.notify) return { status: "charged", receiptId, periodKey, notified: false };
  try {
    await deps.notify({ hostId: expense.hostId, receiptId, telegramChatId: expense.telegramChatId });
    return { status: "charged", receiptId, periodKey, notified: true };
  } catch (error) {
    return { status: "charged", receiptId, periodKey, notified: false, notifyError: error instanceof Error ? error.message : String(error) };
  }
}

/** Charges every due expense once. One failure never stops the others. */
export async function runDueRecurring(deps: RecurringRunnerDeps): Promise<RecurringRunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await listDueRecurring(deps.db, now);
  const results: ({ readonly recurringExpenseId: string; readonly hostId: string } & RecurringOutcome)[] = [];
  for (const expense of due) {
    let outcome: RecurringOutcome;
    try {
      outcome = await runOne(deps, expense, now);
    } catch (error) {
      console.error("[recurring] run failed", expense.id, error);
      outcome = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
    results.push({ recurringExpenseId: expense.id, hostId: expense.hostId, ...outcome });
  }
  const count = (status: RecurringOutcome["status"]) => results.filter((r) => r.status === status).length;
  return {
    ranAt: now.toISOString(),
    due: due.length,
    charged: count("charged"),
    alreadyRan: count("already_ran"),
    skipped: count("skipped"),
    failed: count("failed"),
    results,
  };
}
