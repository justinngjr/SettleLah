import "server-only";

import { InlineKeyboard, type Bot, type Context } from "grammy";

import { formatSGD } from "@/domain";
import { createPaymentClaim, confirmPaymentClaim, rejectPaymentClaim } from "@/server/db/payments";

import { approveBinding, promptQueuedBindings, rejectBinding, requestBinding, type BindingOutcome } from "./bindings";
import {
  findFriendAnyHost,
  findRequestAnyHost,
  getClaim,
  getFriendById,
  getFriendByTelegramUserId,
  getHostByTelegramUserId,
  getHostProfile,
  hasPendingClaim,
  linkChat,
  listShares,
  patchFriend,
  setHostTelegram,
} from "./db";
import type { TelegramDeps } from "./deps";
import { claimKeyboard, decodeCallback, encodeCallback, escapeHtml, TOAST } from "./messages";
import { hostDisplayName } from "./qr";
import { groupChatFor, snoozeRequest } from "./reminders";
import { dmHost, sendTo, sendToFriend } from "./send";
import { consumeLinkToken, parseStartPayload } from "./tokens";

const HELP =
  "Hi! I post bill splits and PayNow QR codes for your host. Open a split link from your group to get reminders here.";

function bindingReply(outcome: BindingOutcome): string {
  switch (outcome.kind) {
    case "unknown_friend":
      return TOAST.unknown;
    case "already_bound":
      return `You're already linked as ${outcome.friend.displayName}.`;
    case "taken":
      return `${outcome.friend.displayName} is already linked to someone else. Ask your host to fix it.`;
    case "pending":
      return outcome.queued
        ? "Got it! Your host will confirm this from the SettleLah app."
        : "Got it! Waiting for your host to confirm.";
  }
}

async function onStart(deps: TelegramDeps, ctx: Context): Promise<void> {
  const payload = parseStartPayload(typeof ctx.match === "string" ? ctx.match : undefined);
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return;

  if (chat.type === "group" || chat.type === "supergroup") {
    if (payload?.kind !== "group") return;
    const token = await consumeLinkToken(deps.db, "group", payload.token, deps.now());
    if (!token) {
      await ctx.reply("That link has expired. Ask the host for a new one.");
      return;
    }
    const host = await getHostProfile(deps.db, token.hostId);
    await linkChat(deps.db, token.hostId, chat.id, chat.title ?? null);
    await ctx.reply(`This group is now linked to ${escapeHtml(host ? hostDisplayName(host) : "your host")}'s SettleLah.`, {
      parse_mode: "HTML",
    });
    return;
  }
  if (chat.type !== "private") return;

  if (!payload) {
    await ctx.reply(HELP);
    return;
  }
  if (payload.kind === "host") {
    const token = await consumeLinkToken(deps.db, "host", payload.token, deps.now());
    if (!token) {
      await ctx.reply("That link has expired. Generate a new one from SettleLah.");
      return;
    }
    await setHostTelegram(deps.db, token.hostId, { userId: from.id, username: from.username ?? null });
    await ctx.reply("Linked! I'll send approval prompts and payment confirmations here.");
    const host = await getHostProfile(deps.db, token.hostId);
    if (host) await promptQueuedBindings(deps, host);
    return;
  }
  if (payload.kind === "friend") {
    const token = await consumeLinkToken(deps.db, "friend", payload.token, deps.now());
    if (!token) {
      await ctx.reply("That link has expired. Ask your host to post the split again.");
      return;
    }
    const bound = await getFriendByTelegramUserId(deps.db, token.hostId, from.id);
    if (bound) {
      if (!bound.privateChatStarted) await patchFriend(deps.db, token.hostId, bound.id, { private_chat_started: true });
      await ctx.reply(`You're linked as ${bound.displayName}. Reminders and PayNow QR codes will arrive here.`);
      return;
    }
    const keyboard = new InlineKeyboard();
    const shares = token.receiptId ? await listShares(deps.db, token.hostId, token.receiptId) : [];
    for (const share of shares) {
      if (share.friendId === null) continue;
      const friend = await getFriendById(deps.db, token.hostId, share.friendId);
      if (!friend || friend.telegramUserId !== null) continue;
      keyboard.text(`That's me (${friend.displayName})`, encodeCallback({ action: "me", friendId: friend.id })).row();
    }
    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply("Everyone on that split is already linked. Ask your host if that's wrong.");
      return;
    }
    await ctx.reply("Which one is you? Your host will confirm.", { reply_markup: keyboard });
    return;
  }
  if (payload.kind === "group") await ctx.reply("Use that link to add me to a group, not here.");
}

async function onCallback(deps: TelegramDeps, ctx: Context): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query) return;
  const cb = decodeCallback(query.data);
  const from = query.from;
  const chat = query.message?.chat;
  const toast = (text: string, alert = false) => ctx.answerCallbackQuery({ text, show_alert: alert });
  if (!cb) {
    await toast(TOAST.unknown);
    return;
  }

  switch (cb.action) {
    case "me": {
      const friend = await findFriendAnyHost(deps.db, cb.friendId);
      if (!friend) {
        await toast(TOAST.unknown);
        return;
      }
      const outcome = await requestBinding(deps, {
        hostId: friend.hostId,
        friendId: friend.id,
        user: from,
        viaPrivateChat: chat?.type === "private",
        sourceChatId: chat && chat.type !== "private" ? chat.id : null,
      });
      await toast(bindingReply(outcome), outcome.kind === "pending");
      return;
    }
    case "bind": {
      const host = await getHostByTelegramUserId(deps.db, from.id);
      if (!host) {
        await toast(TOAST.hostOnly);
        return;
      }
      const outcome = cb.approve ? await approveBinding(host.id, cb.bindingId, deps) : await rejectBinding(host.id, cb.bindingId, deps);
      const text =
        outcome.kind === "approved"
          ? `Linked to ${escapeHtml(outcome.friend.displayName)}.`
          : outcome.kind === "rejected"
            ? "Rejected. Nothing was changed."
            : outcome.kind === "conflict"
              ? `That Telegram user is already linked to ${escapeHtml(outcome.boundTo.displayName)}.`
              : TOAST.alreadyHandled;
      await toast(text);
      if (query.message && (outcome.kind === "approved" || outcome.kind === "rejected")) {
        await ctx.editMessageText(`${escapeHtml(query.message.text ?? "")}\n\n${text}`, { parse_mode: "HTML" }).catch(() => undefined);
      }
      return;
    }
    case "paid":
    case "snooze": {
      const request = await findRequestAnyHost(deps.db, cb.requestId);
      if (!request) {
        await toast(TOAST.unknown);
        return;
      }
      const friend = await getFriendById(deps.db, request.hostId, request.friendId);
      if (!friend || friend.telegramUserId !== from.id) {
        await toast(TOAST.notYourRequest);
        return;
      }
      if (request.status !== "open") {
        await toast(TOAST.alreadyHandled);
        return;
      }
      if (cb.action === "snooze") {
        await snoozeRequest(deps, request, friend);
        await toast("Okay, I'll remind you again tomorrow.");
        return;
      }
      if (await hasPendingClaim(deps.db, request.hostId, request.id)) {
        await toast("Thanks! Your host still has to confirm.");
        return;
      }
      const claim = await createPaymentClaim(deps.db, request.hostId, { paymentRequestId: request.id, source: "friend_button" });
      const host = await getHostProfile(deps.db, request.hostId);
      await dmHost(deps.api, host?.telegramUserId ?? null, {
        text: `${escapeHtml(friend.displayName)} says they've paid ${formatSGD(request.amount)} (ref ${request.reference}). Received?`,
        keyboard: claimKeyboard(claim.id),
      });
      await toast("Thanks! I'll let your host know.");
      return;
    }
    case "claim": {
      const host = await getHostByTelegramUserId(deps.db, from.id);
      if (!host) {
        await toast(TOAST.hostOnly);
        return;
      }
      const claim = await getClaim(deps.db, host.id, cb.claimId);
      if (!claim || claim.status !== "pending") {
        await toast(TOAST.alreadyHandled);
        return;
      }
      const request = await findRequestAnyHost(deps.db, claim.paymentRequestId);
      const friend = request ? await getFriendById(deps.db, host.id, request.friendId) : null;
      let text: string;
      if (cb.confirm) {
        await confirmPaymentClaim(deps.db, claim.id);
        text = "Payment confirmed.";
        if (request && friend) {
          await sendToFriend(deps, friend, await groupChatFor(deps, request), {
            text: `${escapeHtml(hostDisplayName(host))} received your ${formatSGD(request.amount)}. Thanks, ${escapeHtml(friend.displayName)}!`,
          });
        }
      } else {
        await rejectPaymentClaim(deps.db, claim.id);
        text = "Marked as not received. Reminders continue.";
        if (request && friend) {
          await sendToFriend(deps, friend, await groupChatFor(deps, request), {
            text: `${escapeHtml(hostDisplayName(host))} hasn't received your ${formatSGD(request.amount)} yet (ref ${request.reference}).`,
          });
        }
      }
      await toast(text);
      if (query.message) {
        await ctx.editMessageText(`${escapeHtml(query.message.text ?? "")}\n\n${text}`, { parse_mode: "HTML" }).catch(() => undefined);
      }
      return;
    }
  }
}

/** Registers all handlers on `deps.bot`. Idempotent per deps instance. */
export function createBot(deps: TelegramDeps): Bot {
  const bot = deps.bot;
  bot.command("start", (ctx) => onStart(deps, ctx));
  bot.on("callback_query:data", (ctx) => onCallback(deps, ctx));
  bot.catch((error) => {
    console.error("[telegram] update failed", error.error);
  });
  return bot;
}

export { sendTo };
