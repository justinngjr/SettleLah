import "server-only";

import { afterSent, createReminderState, nextReminder } from "@/domain";
import type { Friend } from "@/server/db/friends";
import { createPaymentRequest, type PaymentRequest } from "@/server/db/payments";

import {
  getChat,
  getFriendById,
  getHostProfile,
  getReceipt,
  insertReminderRow,
  listOpenRequestsForReceipt,
  listShares,
  setReceiptChat,
  setRequestReceipt,
} from "./db";
import { depsFromEnv, type TelegramDeps } from "./deps";
import { buildSplitMessage, requestKeyboard, type SplitLine } from "./messages";
import { payNowCaption, renderPayNowQr } from "./qr";
import { sendTo, sendToFriend, type Delivery } from "./send";
import { createLinkToken, friendLinkUrl } from "./tokens";

export interface NotifySplitInput {
  readonly hostId: string;
  readonly receiptId: string;
  readonly telegramChatId: number;
}

export interface NotifySplitResult {
  readonly messageId: number;
  readonly requests: readonly { readonly request: PaymentRequest; readonly delivery: Delivery }[];
}

export class NotifySplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifySplitError";
  }
}

/**
 * Posts the split to a linked group: one summary message (shares, "That's me"
 * buttons for unbound friends, "Get private reminders" deep link), then the
 * PayNow QR for every friend who owes, privately if they have started the bot
 * and otherwise as a reply in the group. Open payment requests are created
 * for the receipt's shares if the host has not created them yet, and each
 * gets a reminder row with stage 0 recorded as sent.
 */
export async function notifySplit(input: NotifySplitInput, deps: TelegramDeps = depsFromEnv()): Promise<NotifySplitResult> {
  const { db } = deps;
  const now = deps.now();
  const host = await getHostProfile(db, input.hostId);
  if (!host) throw new NotifySplitError("host profile not found");
  const chat = await getChat(db, input.hostId, input.telegramChatId);
  if (!chat) throw new NotifySplitError("this Telegram chat is not linked to the host");
  const receipt = await getReceipt(db, input.hostId, input.receiptId);
  if (!receipt) throw new NotifySplitError("receipt not found");
  await setReceiptChat(db, input.hostId, receipt.id, chat.telegramChatId);

  const shares = await listShares(db, input.hostId, receipt.id);
  const lines: SplitLine[] = [];
  for (const share of shares) {
    if (share.friendId === null) continue;
    const friend = await getFriendById(db, input.hostId, share.friendId);
    if (!friend) continue;
    lines.push({ friend, amount: share.amount, owes: !share.paysNothing && share.amount > 0 });
  }

  const existing = await listOpenRequestsForReceipt(db, input.hostId, receipt.id);
  const requests: { request: PaymentRequest; friend: Friend }[] = [];
  for (const line of lines) {
    if (!line.owes) continue;
    let request = existing.find((r) => r.friendId === line.friend.id);
    if (!request) {
      request = await createPaymentRequest(db, input.hostId, { friendId: line.friend.id, amount: line.amount, note: receipt.title });
      await setRequestReceipt(db, input.hostId, request.id, receipt.id);
    }
    requests.push({ request, friend: line.friend });
  }

  const token = await createLinkToken(db, input.hostId, "friend", { receiptId: receipt.id, now });
  const summary = buildSplitMessage({
    title: receipt.title,
    total: receipt.total,
    lines,
    friendLinkUrl: friendLinkUrl(deps.botUsername, token),
  });
  const posted = await sendTo(deps.api, chat.telegramChatId, { text: summary.text, keyboard: summary.keyboard });

  const results: { request: PaymentRequest; delivery: Delivery }[] = [];
  for (const { request, friend } of requests) {
    const qr = await renderPayNowQr(host, request);
    const delivery = await sendToFriend(deps, friend, chat.telegramChatId, {
      text: qr ? qr.caption : payNowCaption(host, request),
      photo: qr?.png,
      keyboard: requestKeyboard(request),
      replyTo: posted.message_id,
    });
    const state = afterSent(
      createReminderState({ splitAt: new Date(request.createdAt), hasPrivateChat: delivery.channel === "private" }),
      now,
    );
    const next = nextReminder(state, now);
    await insertReminderRow(db, {
      payment_request_id: request.id,
      host_id: input.hostId,
      stage: state.stage,
      last_sent_at: now.toISOString(),
      next_at: (next.kind === "wait" ? next.until : now).toISOString(),
      channel: delivery.channel === "private" ? "private" : "group",
    });
    results.push({ request, delivery });
  }
  return { messageId: posted.message_id, requests: results };
}
