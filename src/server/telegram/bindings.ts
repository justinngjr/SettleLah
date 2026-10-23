import "server-only";

import type { User } from "grammy/types";

import type { Friend } from "@/server/db/friends";

import {
  findPendingBinding,
  getBinding,
  getFriendById,
  getFriendByTelegramUserId,
  getHostProfile,
  insertBinding,
  listPendingBindingRows,
  patchFriend,
  resolveBinding,
  setBindingHostMessage,
  type BindingRequest,
  type HostProfile,
} from "./db";
import { depsFromEnv, type TelegramDeps } from "./deps";
import { bindingKeyboard, escapeHtml, telegramHandle } from "./messages";
import { dmHost, sendTo } from "./send";

export type BindingOutcome =
  | { readonly kind: "unknown_friend" }
  | { readonly kind: "already_bound"; readonly friend: Friend }
  | { readonly kind: "taken"; readonly friend: Friend }
  | { readonly kind: "pending"; readonly binding: BindingRequest; readonly queued: boolean };

export interface BindingInput {
  readonly hostId: string;
  readonly friendId: string;
  readonly user: User;
  readonly viaPrivateChat: boolean;
  readonly sourceChatId: number | null;
}

export function bindingPrompt(binding: BindingRequest, friend: Friend): string {
  const handle = telegramHandle({
    id: binding.telegramUserId,
    username: binding.telegramUsername ?? undefined,
    first_name: binding.telegramFirstName ?? undefined,
  });
  return `Link ${escapeHtml(handle)} to ${escapeHtml(friend.displayName)}?`;
}

/** Sends the approve/reject DM for a pending binding; returns false if the host has no Telegram DM. */
async function promptHost(deps: TelegramDeps, host: HostProfile, binding: BindingRequest, friend: Friend): Promise<boolean> {
  const message = await dmHost(deps.api, host.telegramUserId, {
    text: bindingPrompt(binding, friend),
    keyboard: bindingKeyboard(binding.id),
  });
  if (!message) return false;
  await setBindingHostMessage(deps.db, host.id, binding.id, message.message_id);
  return true;
}

/**
 * "That's me" or a private `/start fr_…`: records who claims to be which
 * friend and asks the host. Nothing on the friend record changes until the
 * host approves. Without a host Telegram link the request is queued for the
 * web inbox (`listPendingBindings`).
 */
export async function requestBinding(deps: TelegramDeps, input: BindingInput): Promise<BindingOutcome> {
  const friend = await getFriendById(deps.db, input.hostId, input.friendId);
  if (!friend || friend.archived) return { kind: "unknown_friend" };
  if (friend.telegramUserId === input.user.id) {
    const updated =
      input.viaPrivateChat && !friend.privateChatStarted
        ? await patchFriend(deps.db, input.hostId, friend.id, { private_chat_started: true })
        : friend;
    return { kind: "already_bound", friend: updated };
  }
  if (friend.telegramUserId !== null) return { kind: "taken", friend };

  const existing = await findPendingBinding(deps.db, input.hostId, friend.id, input.user.id);
  const host = await getHostProfile(deps.db, input.hostId);
  if (existing) {
    if (existing.hostMessageId !== null || !host) return { kind: "pending", binding: existing, queued: existing.hostMessageId === null };
    const prompted = await promptHost(deps, host, existing, friend);
    return { kind: "pending", binding: existing, queued: !prompted };
  }
  const binding = await insertBinding(deps.db, {
    host_id: input.hostId,
    friend_id: friend.id,
    telegram_user_id: input.user.id,
    telegram_username: input.user.username ?? null,
    telegram_first_name: input.user.first_name,
    via_private_chat: input.viaPrivateChat,
    source_chat_id: input.sourceChatId,
  });
  const prompted = host ? await promptHost(deps, host, binding, friend) : false;
  return { kind: "pending", binding, queued: !prompted };
}

/** After a host links Telegram, deliver the prompts that were queued for the web inbox. */
export async function promptQueuedBindings(deps: TelegramDeps, host: HostProfile): Promise<number> {
  let sent = 0;
  for (const binding of await listPendingBindingRows(deps.db, host.id)) {
    if (binding.hostMessageId !== null) continue;
    const friend = await getFriendById(deps.db, host.id, binding.friendId);
    if (friend && (await promptHost(deps, host, binding, friend))) sent += 1;
  }
  return sent;
}

export type ResolveOutcome =
  | { readonly kind: "not_found" }
  | { readonly kind: "already_resolved"; readonly binding: BindingRequest }
  | { readonly kind: "conflict"; readonly binding: BindingRequest; readonly boundTo: Friend }
  | { readonly kind: "approved"; readonly binding: BindingRequest; readonly friend: Friend }
  | { readonly kind: "rejected"; readonly binding: BindingRequest };

/**
 * Host approval: sets `friends.telegram_user_id` (and `private_chat_started`
 * when the friend came through a private `/start`) and tells the friend.
 * Usable from the bot and from the web inbox.
 */
export async function approveBinding(hostId: string, bindingId: string, deps: TelegramDeps = depsFromEnv()): Promise<ResolveOutcome> {
  const current = await getBinding(deps.db, hostId, bindingId);
  if (!current) return { kind: "not_found" };
  if (current.status !== "pending") return { kind: "already_resolved", binding: current };
  const boundTo = await getFriendByTelegramUserId(deps.db, hostId, current.telegramUserId);
  if (boundTo && boundTo.id !== current.friendId) return { kind: "conflict", binding: current, boundTo };

  const binding = await resolveBinding(deps.db, hostId, bindingId, "approved", deps.now());
  if (!binding) return { kind: "already_resolved", binding: current };
  const patch = {
    telegram_user_id: binding.telegramUserId,
    telegram_username: binding.telegramUsername,
    ...(binding.viaPrivateChat ? { private_chat_started: true } : {}),
  };
  const friend = await patchFriend(deps.db, hostId, binding.friendId, patch);
  if (friend.privateChatStarted) {
    await sendTo(deps.api, binding.telegramUserId, {
      text: `You're linked as ${escapeHtml(friend.displayName)}. Reminders and PayNow QR codes will arrive here.`,
    }).catch(() => undefined);
  }
  return { kind: "approved", binding, friend };
}

/** Host rejection: the request is closed and the friend record is untouched. */
export async function rejectBinding(hostId: string, bindingId: string, deps: TelegramDeps = depsFromEnv()): Promise<ResolveOutcome> {
  const current = await getBinding(deps.db, hostId, bindingId);
  if (!current) return { kind: "not_found" };
  if (current.status !== "pending") return { kind: "already_resolved", binding: current };
  const binding = await resolveBinding(deps.db, hostId, bindingId, "rejected", deps.now());
  if (!binding) return { kind: "already_resolved", binding: current };
  return { kind: "rejected", binding };
}
