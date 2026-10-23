import "server-only";

import { nextRunAt, type Cents, type RecurringCadence, type RecurringParticipant } from "@/domain";

import type { DbClient } from "./client";
import type { Enums, Json, Tables, TablesInsert, TablesUpdate } from "./database.types";
import { DbError, unwrap, unwrapRequired } from "./errors";

/**
 * Recurring shared expenses: templates the hourly runner turns into ordinary
 * receipts (see `src/server/recurring`). Every query filters on `host_id`;
 * the service role needs that as much as RLS-scoped clients do. Amounts are
 * integer cents. Participants are stored as JSON `[{ id, weight }]` where
 * `id` is a friend id or the host's own id (the host paying the provider
 * can share the cost too; their share is never owed).
 */

export type RecurringExpenseRow = Tables<"recurring_expenses">;
export type RecurringRunRow = Tables<"recurring_runs">;

export interface RecurringExpense {
  readonly id: string;
  readonly hostId: string;
  readonly title: string;
  readonly amount: Cents;
  readonly cadence: RecurringCadence;
  /** Monthly: 1-31 (clamped to month end). Weekly: 0 (Sun) - 6 (Sat). */
  readonly anchorDay: number;
  readonly participants: readonly RecurringParticipant[];
  /** Linked Telegram group the runner posts each split to; null = no post. */
  readonly telegramChatId: number | null;
  readonly nextRunAt: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecurringRun {
  readonly id: string;
  readonly hostId: string;
  readonly recurringExpenseId: string;
  readonly periodKey: string;
  readonly receiptId: string | null;
  readonly ranAt: string;
}

export interface NewRecurringExpense {
  readonly title: string;
  readonly amount: Cents;
  readonly cadence: RecurringCadence;
  readonly anchorDay: number;
  readonly participants: readonly RecurringParticipant[];
  readonly telegramChatId?: number | null;
}

export type RecurringExpensePatch = Partial<NewRecurringExpense>;

export interface RecurringClock {
  /** "Now" for computing the first / next run; defaults to the wall clock. Tests inject a fixed date. */
  readonly now?: Date;
}

/** Bad input from the host or agent (not a database failure). Message is safe to show. */
export class RecurringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurringInputError";
  }
}

export const MAX_RECURRING_TITLE = 120;

export function parseParticipants(json: Json): RecurringParticipant[] {
  if (!Array.isArray(json)) return [];
  const out: RecurringParticipant[] = [];
  for (const entry of json) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const id = entry.id;
    const weight = entry.weight;
    if (typeof id !== "string" || id.length === 0) continue;
    out.push({ id, weight: typeof weight === "number" && Number.isSafeInteger(weight) && weight > 0 ? weight : 1 });
  }
  return out;
}

export function toRecurringExpense(row: RecurringExpenseRow): RecurringExpense {
  return {
    id: row.id,
    hostId: row.host_id,
    title: row.title,
    amount: row.amount,
    cadence: row.cadence,
    anchorDay: row.anchor_day,
    participants: parseParticipants(row.participants),
    telegramChatId: row.telegram_chat_id,
    nextRunAt: row.next_run_at,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRecurringRun(row: RecurringRunRow): RecurringRun {
  return {
    id: row.id,
    hostId: row.host_id,
    recurringExpenseId: row.recurring_expense_id,
    periodKey: row.period_key,
    receiptId: row.receipt_id,
    ranAt: row.ran_at,
  };
}

// validation -----------------------------------------------------------------

function cleanTitle(title: unknown): string {
  const value = typeof title === "string" ? title.trim() : "";
  if (value.length === 0 || value.length > MAX_RECURRING_TITLE) {
    throw new RecurringInputError(`Title: enter a name (up to ${MAX_RECURRING_TITLE} characters).`);
  }
  return value;
}

function cleanAmount(amount: unknown): Cents {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new RecurringInputError("Amount: enter an amount above zero.");
  }
  return amount;
}

function cleanCadence(cadence: unknown): RecurringCadence {
  if (cadence !== "monthly" && cadence !== "weekly") throw new RecurringInputError("Cadence: choose monthly or weekly.");
  return cadence;
}

function cleanAnchorDay(cadence: RecurringCadence, anchorDay: unknown): number {
  const [min, max] = cadence === "monthly" ? [1, 31] : [0, 6];
  if (typeof anchorDay !== "number" || !Number.isSafeInteger(anchorDay) || anchorDay < min || anchorDay > max) {
    throw new RecurringInputError(
      cadence === "monthly" ? "Day of month: choose a day from 1 to 31." : "Day of week: choose a day from Sunday to Saturday.",
    );
  }
  return anchorDay;
}

function cleanParticipants(participants: unknown): RecurringParticipant[] {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new RecurringInputError("Participants: choose at least one person.");
  }
  const seen = new Set<string>();
  return participants.map((p: unknown) => {
    const id = typeof p === "object" && p !== null ? (p as { id?: unknown }).id : undefined;
    const weight = typeof p === "object" && p !== null ? (p as { weight?: unknown }).weight ?? 1 : 1;
    if (typeof id !== "string" || id.length === 0) throw new RecurringInputError("Participants: unknown person.");
    if (seen.has(id)) throw new RecurringInputError("Participants: each person can only be listed once.");
    seen.add(id);
    if (typeof weight !== "number" || !Number.isSafeInteger(weight) || weight <= 0 || weight > 1000) {
      throw new RecurringInputError("Weights: use whole numbers from 1 to 1000.");
    }
    return { id, weight };
  });
}

/** Every participant must be the host or one of the host's (unarchived) friends. */
async function assertParticipantsOwned(db: DbClient, hostId: string, participants: readonly RecurringParticipant[]): Promise<void> {
  const friendIds = participants.map((p) => p.id).filter((id) => id !== hostId);
  if (friendIds.length === 0) return;
  const rows =
    unwrap<Pick<Tables<"friends">, "id">[]>(
      await db.from("friends").select("id").eq("host_id", hostId).eq("archived", false).in("id", friendIds),
      "assertParticipantsOwned",
    ) ?? [];
  const known = new Set(rows.map((r) => r.id));
  if (friendIds.some((id) => !known.has(id))) {
    throw new RecurringInputError("Participants: pick people from your friends list.");
  }
}

async function assertChatOwned(db: DbClient, hostId: string, telegramChatId: number | null | undefined): Promise<void> {
  if (telegramChatId === null || telegramChatId === undefined) return;
  const row = unwrap<Pick<Tables<"telegram_chats">, "id">>(
    await db.from("telegram_chats").select("id").eq("host_id", hostId).eq("telegram_chat_id", telegramChatId).maybeSingle(),
    "assertChatOwned",
  );
  if (!row) throw new RecurringInputError("Telegram group: pick one of your linked groups.");
}

function participantsJson(participants: readonly RecurringParticipant[]): NonNullable<Json> {
  return participants.map((p) => ({ id: p.id, weight: p.weight }));
}

// queries ----------------------------------------------------------------------

export interface ListRecurringOptions {
  readonly activeOnly?: boolean;
}

export async function listRecurring(db: DbClient, hostId: string, options: ListRecurringOptions = {}): Promise<RecurringExpense[]> {
  let query = db.from("recurring_expenses").select("*").eq("host_id", hostId);
  if (options.activeOnly) query = query.eq("active", true);
  const rows = unwrap<RecurringExpenseRow[]>(await query.order("active", { ascending: false }).order("title"), "listRecurring") ?? [];
  return rows.map(toRecurringExpense);
}

export async function getRecurring(db: DbClient, hostId: string, recurringExpenseId: string): Promise<RecurringExpense | null> {
  const row = unwrap<RecurringExpenseRow>(
    await db.from("recurring_expenses").select("*").eq("host_id", hostId).eq("id", recurringExpenseId).maybeSingle(),
    "getRecurring",
  );
  return row ? toRecurringExpense(row) : null;
}

/** Creates an active expense whose first run is the next anchor after `now` (09:00 Singapore). */
export async function createRecurring(
  db: DbClient,
  hostId: string,
  input: NewRecurringExpense,
  clock: RecurringClock = {},
): Promise<RecurringExpense> {
  const now = clock.now ?? new Date();
  const cadence = cleanCadence(input.cadence);
  const anchorDay = cleanAnchorDay(cadence, input.anchorDay);
  const participants = cleanParticipants(input.participants);
  const insert: TablesInsert<"recurring_expenses"> = {
    host_id: hostId,
    title: cleanTitle(input.title),
    amount: cleanAmount(input.amount),
    cadence,
    anchor_day: anchorDay,
    participants: participantsJson(participants),
    telegram_chat_id: input.telegramChatId ?? null,
    next_run_at: nextRunAt({ cadence, anchorDay, from: now }).toISOString(),
    active: true,
  };
  await Promise.all([assertParticipantsOwned(db, hostId, participants), assertChatOwned(db, hostId, input.telegramChatId)]);
  const row = unwrapRequired<RecurringExpenseRow>(
    await db.from("recurring_expenses").insert(insert).select("*").single(),
    "createRecurring",
  );
  return toRecurringExpense(row);
}

/**
 * Edits a template. Changing the cadence or anchor day reschedules the next
 * run from `now`; everything else leaves the schedule alone. Past runs are
 * receipts already and are not touched.
 */
export async function updateRecurring(
  db: DbClient,
  hostId: string,
  recurringExpenseId: string,
  patch: RecurringExpensePatch,
  clock: RecurringClock = {},
): Promise<RecurringExpense> {
  const current = await getRecurring(db, hostId, recurringExpenseId);
  if (!current) throw new DbError("updateRecurring", { message: "recurring expense not found", code: "PGRST116", details: "" });
  const now = clock.now ?? new Date();
  const update: TablesUpdate<"recurring_expenses"> = {};
  if (patch.title !== undefined) update.title = cleanTitle(patch.title);
  if (patch.amount !== undefined) update.amount = cleanAmount(patch.amount);
  const cadence = patch.cadence !== undefined ? cleanCadence(patch.cadence) : current.cadence;
  const anchorDay = cleanAnchorDay(cadence, patch.anchorDay !== undefined ? patch.anchorDay : current.anchorDay);
  if (cadence !== current.cadence || anchorDay !== current.anchorDay) {
    update.cadence = cadence;
    update.anchor_day = anchorDay;
    update.next_run_at = nextRunAt({ cadence, anchorDay, from: now }).toISOString();
  }
  const checks: Promise<void>[] = [];
  if (patch.participants !== undefined) {
    const participants = cleanParticipants(patch.participants);
    update.participants = participantsJson(participants);
    checks.push(assertParticipantsOwned(db, hostId, participants));
  }
  if (patch.telegramChatId !== undefined) {
    update.telegram_chat_id = patch.telegramChatId;
    checks.push(assertChatOwned(db, hostId, patch.telegramChatId));
  }
  await Promise.all(checks);
  if (Object.keys(update).length === 0) return current;
  const row = unwrapRequired<RecurringExpenseRow>(
    await db.from("recurring_expenses").update(update).eq("host_id", hostId).eq("id", recurringExpenseId).select("*").single(),
    "updateRecurring",
  );
  return toRecurringExpense(row);
}

/** Stops future runs. Nothing already charged changes. */
export async function pauseRecurring(db: DbClient, hostId: string, recurringExpenseId: string): Promise<RecurringExpense> {
  const row = unwrapRequired<RecurringExpenseRow>(
    await db
      .from("recurring_expenses")
      .update({ active: false })
      .eq("host_id", hostId)
      .eq("id", recurringExpenseId)
      .select("*")
      .single(),
    "pauseRecurring",
  );
  return toRecurringExpense(row);
}

/** Resumes from the next anchor after `now`: periods missed while paused are not back-charged. */
export async function resumeRecurring(
  db: DbClient,
  hostId: string,
  recurringExpenseId: string,
  clock: RecurringClock = {},
): Promise<RecurringExpense> {
  const current = await getRecurring(db, hostId, recurringExpenseId);
  if (!current) throw new DbError("resumeRecurring", { message: "recurring expense not found", code: "PGRST116", details: "" });
  const now = clock.now ?? new Date();
  const row = unwrapRequired<RecurringExpenseRow>(
    await db
      .from("recurring_expenses")
      .update({ active: true, next_run_at: nextRunAt({ cadence: current.cadence, anchorDay: current.anchorDay, from: now }).toISOString() })
      .eq("host_id", hostId)
      .eq("id", recurringExpenseId)
      .select("*")
      .single(),
    "resumeRecurring",
  );
  return toRecurringExpense(row);
}

/** Removes a template that never ran. Anything with runs is history: pause it instead. */
export async function deleteRecurring(db: DbClient, hostId: string, recurringExpenseId: string): Promise<void> {
  const runs = await listRecurringRuns(db, hostId, recurringExpenseId, 1);
  if (runs.length > 0) throw new RecurringInputError("This expense has already run; pause it instead of deleting it.");
  unwrap(await db.from("recurring_expenses").delete().eq("host_id", hostId).eq("id", recurringExpenseId), "deleteRecurring");
}

export async function listRecurringRuns(
  db: DbClient,
  hostId: string,
  recurringExpenseId: string,
  limit = 12,
): Promise<RecurringRun[]> {
  const rows =
    unwrap<RecurringRunRow[]>(
      await db
        .from("recurring_runs")
        .select("*")
        .eq("host_id", hostId)
        .eq("recurring_expense_id", recurringExpenseId)
        .order("ran_at", { ascending: false })
        .limit(limit),
      "listRecurringRuns",
    ) ?? [];
  return rows.map(toRecurringRun);
}

/** Run counts per expense for a host (for the list screen and the no-delete rule). */
export async function countRecurringRuns(db: DbClient, hostId: string): Promise<ReadonlyMap<string, number>> {
  const rows =
    unwrap<Pick<RecurringRunRow, "recurring_expense_id">[]>(
      await db.from("recurring_runs").select("recurring_expense_id").eq("host_id", hostId),
      "countRecurringRuns",
    ) ?? [];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.recurring_expense_id, (counts.get(row.recurring_expense_id) ?? 0) + 1);
  return counts;
}

// runner --------------------------------------------------------------------------

/**
 * Every active expense across all hosts that is due at `now`. The one
 * deliberately host-unscoped query in this module: it feeds the cron runner,
 * which then scopes every write by the row's `hostId`. Service role only.
 */
export async function listDueRecurring(db: DbClient, now: Date, limit = 200): Promise<RecurringExpense[]> {
  const rows =
    unwrap<RecurringExpenseRow[]>(
      await db
        .from("recurring_expenses")
        .select("*")
        .eq("active", true)
        .lte("next_run_at", now.toISOString())
        .order("next_run_at", { ascending: true })
        .limit(limit),
      "listDueRecurring",
    ) ?? [];
  return rows.map(toRecurringExpense);
}

export interface RunRecurringInput {
  readonly recurringExpenseId: string;
  readonly periodKey: string;
  /** `save_split` arguments (see `buildSaveSplitArgs`); `recurringExpenseId` and the chat are filled in by the RPC. */
  readonly receipt: Json;
  readonly shares: Json;
  readonly nextRunAt: Date;
}

/**
 * One period of one expense in a single transaction (`run_recurring_expense`):
 * run row, receipt, shares, `expense_share` ledger events, `next_run_at`.
 * Returns the receipt id, or null when that period already ran.
 */
export async function runRecurringExpense(db: DbClient, hostId: string, input: RunRecurringInput): Promise<string | null> {
  const receipt = typeof input.receipt === "object" && input.receipt !== null && !Array.isArray(input.receipt) ? input.receipt : {};
  if (receipt.hostId !== hostId) throw new DbError("runRecurringExpense", { message: "receipt hostId does not match the host", code: "22023", details: "" });
  const result = await db.rpc("run_recurring_expense", {
    p_recurring_expense_id: input.recurringExpenseId,
    p_period_key: input.periodKey,
    p_receipt: input.receipt,
    p_shares: input.shares,
    p_next_run_at: input.nextRunAt.toISOString(),
  });
  return unwrap<string>(result, "runRecurringExpense");
}

export type RecurringCadenceEnum = Enums<"recurring_cadence">;
