import "server-only";

import type { DbClient } from "@/server/db/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/server/db/database.types";
import { UNIQUE_VIOLATION, unwrap, unwrapRequired } from "@/server/db/errors";
import { toFriend, type Friend, type FriendRow } from "@/server/db/friends";
import { toPaymentClaim, toPaymentRequest, type PaymentClaim, type PaymentClaimRow, type PaymentRequest, type PaymentRequestRow } from "@/server/db/payments";

/**
 * Host-scoped data access for the bot. The bot runs with the service role, so
 * every query here filters by `host_id` explicitly; the only lookups without a
 * host are the ones that *resolve* a host from a Telegram id (user or chat).
 */

export type ProfileRow = Tables<"profiles">;
export type ChatRow = Tables<"telegram_chats">;
export type ReceiptRow = Tables<"receipts">;
export type ShareRow = Tables<"receipt_shares">;
export type ReminderRow = Tables<"reminders">;
export type BindingRow = Tables<"telegram_binding_requests">;

export interface HostProfile {
  readonly id: string;
  readonly displayName: string | null;
  readonly telegramUserId: number | null;
  readonly telegramUsername: string | null;
  readonly paynowDisplayName: string | null;
  readonly paynowProxyType: ProfileRow["paynow_proxy_type"];
  readonly paynowProxyValue: string | null;
}

export function toHostProfile(row: ProfileRow): HostProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    paynowDisplayName: row.paynow_display_name,
    paynowProxyType: row.paynow_proxy_type,
    paynowProxyValue: row.paynow_proxy_value,
  };
}

export async function getHostProfile(db: DbClient, hostId: string): Promise<HostProfile | null> {
  const row = unwrap<ProfileRow>(await db.from("profiles").select("*").eq("id", hostId).maybeSingle(), "getHostProfile");
  return row ? toHostProfile(row) : null;
}

export async function getHostByTelegramUserId(db: DbClient, telegramUserId: number): Promise<HostProfile | null> {
  const row = unwrap<ProfileRow>(
    await db.from("profiles").select("*").eq("telegram_user_id", telegramUserId).maybeSingle(),
    "getHostByTelegramUserId",
  );
  return row ? toHostProfile(row) : null;
}

export async function setHostTelegram(
  db: DbClient,
  hostId: string,
  telegram: { readonly userId: number; readonly username: string | null },
): Promise<void> {
  unwrapRequired<ProfileRow>(
    await db
      .from("profiles")
      .update({ telegram_user_id: telegram.userId, telegram_username: telegram.username })
      .eq("id", hostId)
      .select("*")
      .single(),
    "setHostTelegram",
  );
}

export interface LinkedChat {
  readonly id: string;
  readonly hostId: string;
  readonly telegramChatId: number;
  readonly title: string | null;
  readonly linkedAt: string;
}

export function toLinkedChat(row: ChatRow): LinkedChat {
  return { id: row.id, hostId: row.host_id, telegramChatId: row.telegram_chat_id, title: row.title, linkedAt: row.linked_at };
}

export async function listChats(db: DbClient, hostId: string): Promise<LinkedChat[]> {
  const rows =
    unwrap<ChatRow[]>(
      await db.from("telegram_chats").select("*").eq("host_id", hostId).order("linked_at", { ascending: false }),
      "listChats",
    ) ?? [];
  return rows.map(toLinkedChat);
}

export async function getChat(db: DbClient, hostId: string, telegramChatId: number): Promise<LinkedChat | null> {
  const row = unwrap<ChatRow>(
    await db.from("telegram_chats").select("*").eq("host_id", hostId).eq("telegram_chat_id", telegramChatId).maybeSingle(),
    "getChat",
  );
  return row ? toLinkedChat(row) : null;
}

/** Resolves which host a group chat belongs to; if several hosts linked the same group, the latest link wins. */
export async function getChatByTelegramId(db: DbClient, telegramChatId: number): Promise<LinkedChat | null> {
  const row = unwrap<ChatRow>(
    await db
      .from("telegram_chats")
      .select("*")
      .eq("telegram_chat_id", telegramChatId)
      .order("linked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "getChatByTelegramId",
  );
  return row ? toLinkedChat(row) : null;
}

export async function linkChat(db: DbClient, hostId: string, telegramChatId: number, title: string | null): Promise<LinkedChat> {
  const row = unwrapRequired<ChatRow>(
    await db
      .from("telegram_chats")
      .upsert({ host_id: hostId, telegram_chat_id: telegramChatId, title }, { onConflict: "host_id,telegram_chat_id" })
      .select("*")
      .single(),
    "linkChat",
  );
  return toLinkedChat(row);
}

export async function getFriendById(db: DbClient, hostId: string, friendId: string): Promise<Friend | null> {
  const row = unwrap<FriendRow>(
    await db.from("friends").select("*").eq("host_id", hostId).eq("id", friendId).maybeSingle(),
    "getFriendById",
  );
  return row ? toFriend(row) : null;
}

export async function getFriendByTelegramUserId(db: DbClient, hostId: string, telegramUserId: number): Promise<Friend | null> {
  const row = unwrap<FriendRow>(
    await db.from("friends").select("*").eq("host_id", hostId).eq("telegram_user_id", telegramUserId).maybeSingle(),
    "getFriendByTelegramUserId",
  );
  return row ? toFriend(row) : null;
}

export async function patchFriend(db: DbClient, hostId: string, friendId: string, patch: TablesUpdate<"friends">): Promise<Friend> {
  const row = unwrapRequired<FriendRow>(
    await db.from("friends").update(patch).eq("host_id", hostId).eq("id", friendId).select("*").single(),
    "patchFriend",
  );
  return toFriend(row);
}

export interface Receipt {
  readonly id: string;
  readonly hostId: string;
  readonly title: string;
  readonly total: number;
  readonly occurredAt: string;
  readonly telegramChatId: number | null;
}

export async function getReceipt(db: DbClient, hostId: string, receiptId: string): Promise<Receipt | null> {
  const row = unwrap<ReceiptRow>(
    await db.from("receipts").select("*").eq("host_id", hostId).eq("id", receiptId).maybeSingle(),
    "getReceipt",
  );
  if (!row) return null;
  return { id: row.id, hostId: row.host_id, title: row.title, total: row.total, occurredAt: row.occurred_at, telegramChatId: row.telegram_chat_id };
}

export async function setReceiptChat(db: DbClient, hostId: string, receiptId: string, telegramChatId: number): Promise<void> {
  unwrap(
    await db.from("receipts").update({ telegram_chat_id: telegramChatId }).eq("host_id", hostId).eq("id", receiptId),
    "setReceiptChat",
  );
}

export interface Share {
  readonly friendId: string | null;
  readonly amount: number;
  readonly paysNothing: boolean;
}

export async function listShares(db: DbClient, hostId: string, receiptId: string): Promise<Share[]> {
  const rows =
    unwrap<ShareRow[]>(
      await db.from("receipt_shares").select("*").eq("host_id", hostId).eq("receipt_id", receiptId),
      "listShares",
    ) ?? [];
  return rows.map((row) => ({ friendId: row.friend_id, amount: row.amount, paysNothing: row.pays_nothing }));
}

export async function getPaymentRequest(db: DbClient, hostId: string, requestId: string): Promise<PaymentRequest | null> {
  const row = unwrap<PaymentRequestRow>(
    await db.from("payment_requests").select("*").eq("host_id", hostId).eq("id", requestId).maybeSingle(),
    "getPaymentRequest",
  );
  return row ? toPaymentRequest(row) : null;
}

export async function listOpenRequestsForReceipt(db: DbClient, hostId: string, receiptId: string): Promise<PaymentRequest[]> {
  const rows =
    unwrap<PaymentRequestRow[]>(
      await db.from("payment_requests").select("*").eq("host_id", hostId).eq("receipt_id", receiptId).eq("status", "open"),
      "listOpenRequestsForReceipt",
    ) ?? [];
  return rows.map(toPaymentRequest);
}

export async function setRequestReceipt(db: DbClient, hostId: string, requestId: string, receiptId: string): Promise<void> {
  unwrap(
    await db.from("payment_requests").update({ receipt_id: receiptId }).eq("host_id", hostId).eq("id", requestId),
    "setRequestReceipt",
  );
}

/** The receipt a request was raised for, if any; used to find the group chat. */
export async function getRequestReceiptId(db: DbClient, hostId: string, requestId: string): Promise<string | null> {
  const row = unwrap<Pick<PaymentRequestRow, "receipt_id">>(
    await db.from("payment_requests").select("receipt_id").eq("host_id", hostId).eq("id", requestId).maybeSingle(),
    "getRequestReceiptId",
  );
  return row?.receipt_id ?? null;
}

/** Every open request across all hosts: the cron's work list. Host scoping happens per row afterwards. */
export async function listAllOpenRequests(db: DbClient): Promise<PaymentRequest[]> {
  const rows =
    unwrap<PaymentRequestRow[]>(
      await db.from("payment_requests").select("*").eq("status", "open").order("created_at", { ascending: true }),
      "listAllOpenRequests",
    ) ?? [];
  return rows.map(toPaymentRequest);
}

export async function getClaim(db: DbClient, hostId: string, claimId: string): Promise<PaymentClaim | null> {
  const row = unwrap<PaymentClaimRow>(
    await db.from("payment_claims").select("*").eq("host_id", hostId).eq("id", claimId).maybeSingle(),
    "getClaim",
  );
  return row ? toPaymentClaim(row) : null;
}

export async function hasPendingClaim(db: DbClient, hostId: string, requestId: string): Promise<boolean> {
  const rows =
    unwrap<Pick<PaymentClaimRow, "id">[]>(
      await db
        .from("payment_claims")
        .select("id")
        .eq("host_id", hostId)
        .eq("payment_request_id", requestId)
        .eq("status", "pending")
        .limit(1),
      "hasPendingClaim",
    ) ?? [];
  return rows.length > 0;
}

export interface BindingRequest {
  readonly id: string;
  readonly hostId: string;
  readonly friendId: string;
  readonly telegramUserId: number;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly viaPrivateChat: boolean;
  readonly sourceChatId: number | null;
  readonly hostMessageId: number | null;
  readonly status: BindingRow["status"];
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export function toBindingRequest(row: BindingRow): BindingRequest {
  return {
    id: row.id,
    hostId: row.host_id,
    friendId: row.friend_id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    telegramFirstName: row.telegram_first_name,
    viaPrivateChat: row.via_private_chat,
    sourceChatId: row.source_chat_id,
    hostMessageId: row.host_message_id,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function findPendingBinding(
  db: DbClient,
  hostId: string,
  friendId: string,
  telegramUserId: number,
): Promise<BindingRequest | null> {
  const row = unwrap<BindingRow>(
    await db
      .from("telegram_binding_requests")
      .select("*")
      .eq("host_id", hostId)
      .eq("friend_id", friendId)
      .eq("telegram_user_id", telegramUserId)
      .eq("status", "pending")
      .maybeSingle(),
    "findPendingBinding",
  );
  return row ? toBindingRequest(row) : null;
}

export async function insertBinding(db: DbClient, insert: TablesInsert<"telegram_binding_requests">): Promise<BindingRequest> {
  const row = unwrapRequired<BindingRow>(
    await db.from("telegram_binding_requests").insert(insert).select("*").single(),
    "insertBinding",
  );
  return toBindingRequest(row);
}

export async function getBinding(db: DbClient, hostId: string, bindingId: string): Promise<BindingRequest | null> {
  const row = unwrap<BindingRow>(
    await db.from("telegram_binding_requests").select("*").eq("host_id", hostId).eq("id", bindingId).maybeSingle(),
    "getBinding",
  );
  return row ? toBindingRequest(row) : null;
}

export async function setBindingHostMessage(db: DbClient, hostId: string, bindingId: string, messageId: number): Promise<void> {
  unwrap(
    await db.from("telegram_binding_requests").update({ host_message_id: messageId }).eq("host_id", hostId).eq("id", bindingId),
    "setBindingHostMessage",
  );
}

/** Resolves a pending binding; returns `null` when it was already resolved (two taps, two hosts' devices). */
export async function resolveBinding(
  db: DbClient,
  hostId: string,
  bindingId: string,
  status: "approved" | "rejected",
  now: Date,
): Promise<BindingRequest | null> {
  const row = unwrap<BindingRow>(
    await db
      .from("telegram_binding_requests")
      .update({ status, resolved_at: now.toISOString() })
      .eq("host_id", hostId)
      .eq("id", bindingId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle(),
    "resolveBinding",
  );
  return row ? toBindingRequest(row) : null;
}

export async function listPendingBindingRows(db: DbClient, hostId: string): Promise<BindingRequest[]> {
  const rows =
    unwrap<BindingRow[]>(
      await db
        .from("telegram_binding_requests")
        .select("*")
        .eq("host_id", hostId)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      "listPendingBindingRows",
    ) ?? [];
  return rows.map(toBindingRequest);
}

export async function getReminderRow(db: DbClient, hostId: string, requestId: string): Promise<ReminderRow | null> {
  return unwrap<ReminderRow>(
    await db.from("reminders").select("*").eq("host_id", hostId).eq("payment_request_id", requestId).maybeSingle(),
    "getReminderRow",
  );
}

/** Creates the reminder row for a request; a concurrent creator winning the race is not an error. */
export async function insertReminderRow(db: DbClient, insert: TablesInsert<"reminders">): Promise<ReminderRow | null> {
  const result = await db.from("reminders").insert(insert).select("*").single();
  if (result.error?.code === UNIQUE_VIOLATION) return null;
  return unwrapRequired<ReminderRow>(result, "insertReminderRow");
}

export interface ReminderCas {
  readonly stage: number;
  readonly lastSentAt: string | null;
}

/**
 * Compare-and-set update: only applies when the row still has the stage and
 * `last_sent_at` the caller read, so two cron runs cannot both claim a send.
 */
export async function casUpdateReminder(
  db: DbClient,
  hostId: string,
  reminderId: string,
  expected: ReminderCas,
  patch: TablesUpdate<"reminders">,
): Promise<ReminderRow | null> {
  let query = db.from("reminders").update(patch).eq("host_id", hostId).eq("id", reminderId).eq("stage", expected.stage);
  query = expected.lastSentAt === null ? query.is("last_sent_at", null) : query.eq("last_sent_at", expected.lastSentAt);
  const row = unwrap<ReminderRow>(await query.select("*").maybeSingle(), "casUpdateReminder");
  return row;
}

/** Marks escalation exactly once: the update only matches while `escalated_at` is null. */
export async function claimEscalation(db: DbClient, hostId: string, reminderId: string, now: Date): Promise<boolean> {
  const row = unwrap<ReminderRow>(
    await db
      .from("reminders")
      .update({ escalated_at: now.toISOString() })
      .eq("host_id", hostId)
      .eq("id", reminderId)
      .is("escalated_at", null)
      .select("*")
      .maybeSingle(),
    "claimEscalation",
  );
  return row !== null;
}

export async function updateReminder(db: DbClient, hostId: string, reminderId: string, patch: TablesUpdate<"reminders">): Promise<void> {
  unwrap(await db.from("reminders").update(patch).eq("host_id", hostId).eq("id", reminderId), "updateReminder");
}

/**
 * Lookups keyed only by an unguessable uuid from callback data; the row's own
 * `host_id` then scopes everything that follows.
 */
export async function findFriendAnyHost(db: DbClient, friendId: string): Promise<Friend | null> {
  const row = unwrap<FriendRow>(await db.from("friends").select("*").eq("id", friendId).maybeSingle(), "findFriendAnyHost");
  return row ? toFriend(row) : null;
}

export async function findRequestAnyHost(db: DbClient, requestId: string): Promise<PaymentRequest | null> {
  const row = unwrap<PaymentRequestRow>(
    await db.from("payment_requests").select("*").eq("id", requestId).maybeSingle(),
    "findRequestAnyHost",
  );
  return row ? toPaymentRequest(row) : null;
}
