import "server-only";

import { afterSent, afterSnooze, formatSGD, MAX_STAGE, nextReminder, reminderMessage, type ReminderState } from "@/domain";
import type { Friend } from "@/server/db/friends";
import type { PaymentRequest } from "@/server/db/payments";

import {
  casUpdateReminder,
  claimEscalation,
  getFriendById,
  getHostProfile,
  getPaymentRequest,
  getReceipt,
  getReminderRow,
  getRequestReceiptId,
  hasPendingClaim,
  insertReminderRow,
  listAllOpenRequests,
  listChats,
  updateReminder,
  type HostProfile,
  type ReminderRow,
} from "./db";
import type { TelegramDeps } from "./deps";
import { escapeHtml, requestKeyboard } from "./messages";
import { hostDisplayName, renderPayNowQr } from "./qr";
import { dmHost, sendToFriend } from "./send";

export function toReminderState(row: ReminderRow, request: PaymentRequest, friend: Friend, claimPending: boolean): ReminderState {
  return {
    splitAt: new Date(request.createdAt),
    status: request.status === "open" ? (claimPending ? "claim_pending" : "open") : request.status,
    hasPrivateChat: friend.privateChatStarted && friend.telegramUserId !== null,
    stage: row.stage,
    ...(row.last_sent_at === null ? {} : { lastSentAt: new Date(row.last_sent_at) }),
    ...(row.snoozed_until === null ? {} : { snoozedUntil: new Date(row.snoozed_until) }),
  };
}

function nextAtOf(state: ReminderState, now: Date): string {
  const decision = nextReminder(state, now);
  return (decision.kind === "wait" ? decision.until : now).toISOString();
}

/** Loads the reminder row for a request, creating the stage-0 row on first sight. */
export async function loadReminderRow(deps: TelegramDeps, request: PaymentRequest, friend: Friend): Promise<ReminderRow> {
  const existing = await getReminderRow(deps.db, request.hostId, request.id);
  if (existing) return existing;
  const inserted = await insertReminderRow(deps.db, {
    payment_request_id: request.id,
    host_id: request.hostId,
    stage: 0,
    next_at: request.createdAt,
    channel: friend.privateChatStarted ? "private" : "group",
  });
  if (inserted) return inserted;
  const raced = await getReminderRow(deps.db, request.hostId, request.id);
  if (!raced) throw new Error(`reminder row for request ${request.id} vanished`);
  return raced;
}

/** "Remind me later": persists `afterSnooze` without sending anything. */
export async function snoozeRequest(deps: TelegramDeps, request: PaymentRequest, friend: Friend): Promise<ReminderState> {
  const now = deps.now();
  const row = await loadReminderRow(deps, request, friend);
  const state = afterSnooze(toReminderState(row, request, friend, await hasPendingClaim(deps.db, request.hostId, request.id)), now);
  await updateReminder(deps.db, request.hostId, row.id, {
    snoozed_until: state.snoozedUntil?.toISOString() ?? null,
    next_at: nextAtOf(state, now),
  });
  return state;
}

/** The group chat a request's reminders fall back to: the receipt's chat, else the host's most recent linked chat. */
export async function groupChatFor(deps: TelegramDeps, request: PaymentRequest): Promise<number | null> {
  const receiptId = await getRequestReceiptId(deps.db, request.hostId, request.id);
  if (receiptId) {
    const receipt = await getReceipt(deps.db, request.hostId, receiptId);
    if (receipt?.telegramChatId) return receipt.telegramChatId;
  }
  const chats = await listChats(deps.db, request.hostId);
  return chats[0]?.telegramChatId ?? null;
}

export function escalationMessage(friend: Friend, request: PaymentRequest): string {
  return (
    `${escapeHtml(friend.displayName)} still hasn't paid ${formatSGD(request.amount)} (ref ${request.reference}) ` +
    `after ${MAX_STAGE} reminders. I've stopped nudging them; you may want to follow up yourself.`
  );
}

export type RequestOutcome = "sent" | "waiting" | "paused" | "done" | "escalated" | "skipped" | "unreachable" | "error";

export interface CronSummary {
  readonly scanned: number;
  readonly counts: Readonly<Record<RequestOutcome, number>>;
  readonly errors: readonly { readonly requestId: string; readonly message: string }[];
}

async function processRequest(deps: TelegramDeps, host: HostProfile, request: PaymentRequest): Promise<RequestOutcome> {
  const now = deps.now();
  const friend = await getFriendById(deps.db, request.hostId, request.friendId);
  if (!friend) return "skipped";
  const row = await loadReminderRow(deps, request, friend);
  const state = toReminderState(row, request, friend, await hasPendingClaim(deps.db, request.hostId, request.id));
  const decision = nextReminder(state, now);

  switch (decision.kind) {
    case "wait":
      return "waiting";
    case "paused":
      return "paused";
    case "done":
      return "done";
    case "escalate_to_host": {
      if (!(await claimEscalation(deps.db, request.hostId, row.id, now))) return "skipped";
      await dmHost(deps.api, host.telegramUserId, { text: escalationMessage(friend, request) });
      return "escalated";
    }
    case "send":
      return sendStage(deps, host, request, friend, row, state);
  }
}

/**
 * Sends the pending stage to the friend and advances the reminder row. Shared
 * by the cron tick and the host's "remind now"; the compare-and-set on
 * (stage, last_sent_at) makes concurrent callers send at most once.
 */
async function sendStage(
  deps: TelegramDeps,
  host: HostProfile,
  request: PaymentRequest,
  friend: Friend,
  row: ReminderRow,
  state: ReminderState,
): Promise<"sent" | "skipped" | "unreachable"> {
  const now = deps.now();
  const groupChatId = await groupChatFor(deps, request);
  if (!state.hasPrivateChat && groupChatId === null) return "unreachable";
  const sent = afterSent(state, now);
  const channel = state.hasPrivateChat ? "private" : "group";
  const claimed = await casUpdateReminder(
    deps.db,
    request.hostId,
    row.id,
    { stage: row.stage, lastSentAt: row.last_sent_at },
    {
      stage: sent.stage,
      last_sent_at: now.toISOString(),
      snoozed_until: null,
      next_at: nextAtOf(sent, now),
      channel,
    },
  );
  if (!claimed) return "skipped";
  const text = reminderMessage({
    stage: state.stage,
    friendName: friend.displayName,
    amount: request.amount,
    hostName: hostDisplayName(host),
  });
  const qr = state.stage === 0 ? await renderPayNowQr(host, request) : null;
  const delivery = await sendToFriend(deps, friend, groupChatId, {
    text: qr ? `${escapeHtml(text)}\n\n${qr.caption}` : escapeHtml(text),
    photo: qr?.png,
    keyboard: requestKeyboard(request),
  });
  return delivery.channel === "none" ? "unreachable" : "sent";
}

export type RemindNowOutcome = "sent" | "unreachable" | "done" | "skipped";

/**
 * The host asks for a reminder right now, ahead of the schedule: sends the
 * pending stage immediately (ignoring quiet hours and snooze) if the request
 * is still open and the schedule is not exhausted.
 */
export async function sendReminderNow(deps: TelegramDeps, hostId: string, requestId: string): Promise<RemindNowOutcome> {
  const request = await getPaymentRequest(deps.db, hostId, requestId);
  if (!request || request.status !== "open") return "done";
  const host = await getHostProfile(deps.db, hostId);
  const friend = await getFriendById(deps.db, hostId, request.friendId);
  if (!host || !friend) return "skipped";
  const row = await loadReminderRow(deps, request, friend);
  const state = toReminderState(row, request, friend, await hasPendingClaim(deps.db, hostId, request.id));
  if (state.stage > MAX_STAGE) return "done";
  return sendStage(deps, host, request, friend, row, state);
}

/**
 * One cron tick: walks every open payment request, asks the domain what to do
 * and does exactly that. Safe to run concurrently: a send is only performed by
 * the invocation whose compare-and-set on (stage, last_sent_at) succeeded, and
 * escalation is claimed through `escalated_at`.
 */
export async function runReminders(deps: TelegramDeps): Promise<CronSummary> {
  const requests = await listAllOpenRequests(deps.db);
  const counts: Record<RequestOutcome, number> = {
    sent: 0,
    waiting: 0,
    paused: 0,
    done: 0,
    escalated: 0,
    skipped: 0,
    unreachable: 0,
    error: 0,
  };
  const errors: { requestId: string; message: string }[] = [];
  const hosts = new Map<string, HostProfile | null>();
  for (const request of requests) {
    try {
      let host = hosts.get(request.hostId);
      if (host === undefined) {
        host = await getHostProfile(deps.db, request.hostId);
        hosts.set(request.hostId, host);
      }
      if (!host) {
        counts.skipped += 1;
        continue;
      }
      counts[await processRequest(deps, host, request)] += 1;
    } catch (error) {
      counts.error += 1;
      errors.push({ requestId: request.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { scanned: requests.length, counts, errors };
}
