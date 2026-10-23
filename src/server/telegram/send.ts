import "server-only";

import { GrammyError, InputFile, type Api, type InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";

import type { Friend } from "@/server/db/friends";

import { patchFriend } from "./db";
import type { TelegramDeps } from "./deps";

export interface Outgoing {
  readonly text: string;
  readonly keyboard?: InlineKeyboard;
  /** PNG to send as a photo with `text` as caption instead of a plain message. */
  readonly photo?: Buffer;
  /** Reply to this message when sending in the group. */
  readonly replyTo?: number;
}

export type Delivery = { readonly channel: "private" | "group"; readonly message: Message } | { readonly channel: "none" };

export function isBlockedError(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 403;
}

export async function sendTo(api: Api, chatId: number, out: Outgoing): Promise<Message> {
  const common = {
    parse_mode: "HTML" as const,
    reply_markup: out.keyboard,
    reply_parameters: out.replyTo === undefined ? undefined : { message_id: out.replyTo },
  };
  if (out.photo) {
    return api.sendPhoto(chatId, new InputFile(out.photo, "paynow.png"), { caption: out.text, ...common });
  }
  return api.sendMessage(chatId, out.text, common);
}

/**
 * DMs the friend if they have started the bot, otherwise posts in the group.
 * A 403 (friend blocked the bot) clears `private_chat_started` and falls back
 * to the group for this and all later messages.
 */
export async function sendToFriend(
  deps: TelegramDeps,
  friend: Friend,
  groupChatId: number | null,
  out: Outgoing,
): Promise<Delivery> {
  if (friend.privateChatStarted && friend.telegramUserId !== null) {
    try {
      const message = await sendTo(deps.api, friend.telegramUserId, { ...out, replyTo: undefined });
      return { channel: "private", message };
    } catch (error) {
      if (!isBlockedError(error)) throw error;
      await patchFriend(deps.db, friend.hostId, friend.id, { private_chat_started: false });
    }
  }
  if (groupChatId === null) return { channel: "none" };
  const message = await sendTo(deps.api, groupChatId, out);
  return { channel: "group", message };
}

/** DMs the host; `null` when the host has not linked Telegram or blocked the bot. */
export async function dmHost(api: Api, hostTelegramUserId: number | null, out: Outgoing): Promise<Message | null> {
  if (hostTelegramUserId === null) return null;
  try {
    return await sendTo(api, hostTelegramUserId, out);
  } catch (error) {
    if (isBlockedError(error)) return null;
    throw error;
  }
}
