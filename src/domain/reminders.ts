import type { Cents } from "./money";
import { assertNonNegativeCents, formatSGD } from "./money";
import { assertDate, fromSgt, MS_PER_DAY, MS_PER_HOUR, toSgt } from "./sgt";

/**
 * Payment reminder schedule. Reminders must stay polite so friends do not
 * block the bot: a fixed, slowing cadence, a quiet-hours window in Singapore
 * time, a "remind me later" snooze, and a hard stop after which the host
 * decides what to do.
 *
 * Every function takes the current instant as an argument; nothing here
 * reads the system clock.
 */

/** Whether the friend still owes, has claimed to pay, or is settled. */
export type ReminderStatus = "open" | "claim_pending" | "paid" | "cancelled";

export type ReminderChannel = "private" | "group";

export interface ReminderState {
  /** When the bill was split; anchor for the whole schedule. */
  readonly splitAt: Date;
  readonly status: ReminderStatus;
  /** True once the friend has started a private chat with the bot. */
  readonly hasPrivateChat: boolean;
  /** The next stage to send, starting at 0. */
  readonly stage: number;
  readonly lastSentAt?: Date;
  /** Set by "Remind me later"; cleared when the next reminder is sent. */
  readonly snoozedUntil?: Date;
}

export type ReminderDecision =
  | { readonly kind: "send"; readonly at: Date; readonly stage: number; readonly channel: ReminderChannel }
  | { readonly kind: "wait"; readonly until: Date }
  | { readonly kind: "done" }
  | { readonly kind: "paused" }
  | { readonly kind: "escalate_to_host" };

export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderError";
  }
}

/** Stage 0 goes out when the bill is split; stage 1 is the first nudge. */
export const FIRST_NUDGE_DELAY_MS = 2 * MS_PER_DAY;
/** Stages 2.. follow weekly after stage 1. */
export const WEEKLY_INTERVAL_MS = 7 * MS_PER_DAY;
/** The last stage sent to the friend. */
export const MAX_STAGE = 6;
export const SNOOZE_MS = 24 * MS_PER_HOUR;
/** Reminders are only sent at or after 10:00 and before 21:00 Asia/Singapore. */
export const QUIET_HOURS = { sendFromHour: 10, sendUntilHour: 21 } as const;

const STATUSES: readonly ReminderStatus[] = ["open", "claim_pending", "paid", "cancelled"];

export function createReminderState(input: { splitAt: Date; hasPrivateChat?: boolean }): ReminderState {
  return {
    splitAt: assertDate(input.splitAt, "splitAt"),
    status: "open",
    hasPrivateChat: input.hasPrivateChat === true,
    stage: 0,
  };
}

export function assertReminderState(state: ReminderState): ReminderState {
  if (typeof state !== "object" || state === null) {
    throw new ReminderError("reminder state must be an object");
  }
  assertDate(state.splitAt, "splitAt");
  if (!STATUSES.includes(state.status)) {
    throw new ReminderError(`status must be one of ${STATUSES.join(", ")}; got ${String(state.status)}`);
  }
  if (typeof state.hasPrivateChat !== "boolean") {
    throw new ReminderError("hasPrivateChat must be a boolean");
  }
  if (!Number.isSafeInteger(state.stage) || state.stage < 0) {
    throw new ReminderError(`stage must be a non-negative integer, got ${String(state.stage)}`);
  }
  if (state.lastSentAt !== undefined) assertDate(state.lastSentAt, "lastSentAt");
  if (state.snoozedUntil !== undefined) assertDate(state.snoozedUntil, "snoozedUntil");
  return state;
}

/**
 * The nominal time of `stage` relative to the split, before quiet hours and
 * snoozes: 0 -> at split, 1 -> +2 days, n >= 2 -> +2 days + 7 × (n − 1) days.
 */
export function scheduledAt(splitAt: Date, stage: number): Date {
  assertDate(splitAt, "splitAt");
  if (!Number.isSafeInteger(stage) || stage < 0) {
    throw new ReminderError(`stage must be a non-negative integer, got ${String(stage)}`);
  }
  if (stage === 0) return new Date(splitAt.getTime());
  return new Date(splitAt.getTime() + FIRST_NUDGE_DELAY_MS + (stage - 1) * WEEKLY_INTERVAL_MS);
}

/**
 * Moves an instant into the sending window: unchanged when it is already
 * between 10:00 and 20:59:59 Singapore time, otherwise the next 10:00 SGT.
 */
export function nextSendWindow(instant: Date): Date {
  const sgt = toSgt(instant);
  if (sgt.hour >= QUIET_HOURS.sendFromHour && sgt.hour < QUIET_HOURS.sendUntilHour) {
    return new Date(instant.getTime());
  }
  const dayOffset = sgt.hour < QUIET_HOURS.sendFromHour ? 0 : 1;
  return fromSgt(sgt.year, sgt.month, sgt.day + dayOffset, QUIET_HOURS.sendFromHour);
}

function laterOf(a: Date, b: Date | undefined): Date {
  return b !== undefined && b.getTime() > a.getTime() ? b : a;
}

/**
 * When the pending stage is actually due: nominal time, pushed by any snooze,
 * then into the send window. Stage 0 is the host-initiated split message and
 * goes out immediately whatever the hour; quiet hours apply to automated
 * nudges (stage >= 1) and to anything that was snoozed.
 */
export function dueAt(state: ReminderState): Date {
  assertReminderState(state);
  const nominal = laterOf(scheduledAt(state.splitAt, state.stage), state.snoozedUntil);
  if (state.stage === 0 && state.snoozedUntil === undefined) return nominal;
  return nextSendWindow(nominal);
}

/**
 * Decides what the scheduler should do at `now`.
 *
 * - paid / cancelled -> `done`; a pending payment claim -> `paused`.
 * - stage 0 -> `send` as soon as the bill is split (no quiet hours).
 * - stages 1..6 -> `send` once due (quiet hours and snooze applied), else `wait`.
 * - after stage 6, when the next weekly slot comes round unpaid -> `escalate_to_host`
 *   (the friend got a week to act on the final reminder first).
 */
export function nextReminder(state: ReminderState, now: Date): ReminderDecision {
  assertReminderState(state);
  assertDate(now, "now");
  if (state.status === "paid" || state.status === "cancelled") return { kind: "done" };
  if (state.status === "claim_pending") return { kind: "paused" };

  if (state.stage > MAX_STAGE) {
    const escalateAt = scheduledAt(state.splitAt, MAX_STAGE + 1);
    if (now.getTime() >= escalateAt.getTime()) return { kind: "escalate_to_host" };
    return { kind: "wait", until: escalateAt };
  }

  const at = dueAt(state);
  if (now.getTime() < at.getTime()) return { kind: "wait", until: at };
  return { kind: "send", at, stage: state.stage, channel: state.hasPrivateChat ? "private" : "group" };
}

/** State after the pending stage was sent at `sentAt`; the snooze (if any) is consumed. */
export function afterSent(state: ReminderState, sentAt: Date): ReminderState {
  assertReminderState(state);
  assertDate(sentAt, "sentAt");
  if (state.stage > MAX_STAGE) {
    throw new ReminderError(`stage ${state.stage} is past the last reminder stage ${MAX_STAGE}`);
  }
  const { snoozedUntil: _consumed, ...rest } = state;
  void _consumed;
  return { ...rest, stage: state.stage + 1, lastSentAt: new Date(sentAt.getTime()) };
}

/**
 * State after the friend tapped "Remind me later" at `tappedAt`: the next
 * reminder waits at least 24 hours from the tap, and never comes earlier than
 * it would have anyway. Tapping again extends an existing snooze.
 */
export function afterSnooze(state: ReminderState, tappedAt: Date): ReminderState {
  assertReminderState(state);
  assertDate(tappedAt, "tappedAt");
  const snoozedUntil = laterOf(new Date(tappedAt.getTime() + SNOOZE_MS), state.snoozedUntil);
  return { ...state, snoozedUntil };
}

export interface ReminderMessageInput {
  readonly stage: number;
  readonly friendName: string;
  readonly amount: Cents;
  readonly hostName: string;
}

function assertName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReminderError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Short, friendly copy for each stage. Never guilt-trips: it states the
 * amount, offers an out ("Remind me later", "I've paid") and, at the last
 * stage, says the bot will stop.
 */
export function reminderMessage(input: ReminderMessageInput): string {
  const friend = assertName(input.friendName, "friendName");
  const host = assertName(input.hostName, "hostName");
  const amount = formatSGD(assertNonNegativeCents(input.amount, "amount"));
  if (!Number.isSafeInteger(input.stage) || input.stage < 0 || input.stage > MAX_STAGE) {
    throw new ReminderError(`stage must be between 0 and ${MAX_STAGE}, got ${String(input.stage)}`);
  }
  switch (input.stage) {
    case 0:
      return `Hi ${friend}! ${host} just split the bill and your share is ${amount}. Pay whenever it's convenient, no rush.`;
    case 1:
      return `Hi ${friend}, a gentle nudge from ${host}: your ${amount} share of the bill is still open. Whenever you get a moment!`;
    case 2:
      return `Hi ${friend}, just checking in: ${amount} to ${host} is still outstanding. Already paid? Tap "I've paid" and we'll sort it out.`;
    case 3:
      return `Hi ${friend}, friendly reminder that ${amount} to ${host} is still open. Need more time? Tap "Remind me later".`;
    case 4:
      return `Hi ${friend}, ${amount} to ${host} is still pending from a while back. A quick PayNow sorts it out whenever you're free.`;
    case 5:
      return `Hi ${friend}, one more reminder about the ${amount} owed to ${host}. If the amount looks off, just let ${host} know.`;
    default:
      return `Hi ${friend}, this is my last reminder about ${amount} to ${host}. After this I'll leave it to ${host} to follow up directly.`;
  }
}
