import "server-only";

import { InlineKeyboard } from "grammy";

import { formatSGD } from "@/domain";
import type { Friend } from "@/server/db/friends";
import type { PaymentRequest } from "@/server/db/payments";

/** Callback data (max 64 bytes): `<action>:<uuid>`; approve/reject variants carry a flag. */
export type Callback =
  | { readonly action: "me"; readonly friendId: string }
  | { readonly action: "bind"; readonly approve: boolean; readonly bindingId: string }
  | { readonly action: "paid"; readonly requestId: string }
  | { readonly action: "snooze"; readonly requestId: string }
  | { readonly action: "claim"; readonly confirm: boolean; readonly claimId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCallback(cb: Callback): string {
  switch (cb.action) {
    case "me":
      return `me:${cb.friendId}`;
    case "bind":
      return `bind:${cb.approve ? "a" : "r"}:${cb.bindingId}`;
    case "paid":
      return `paid:${cb.requestId}`;
    case "snooze":
      return `snooze:${cb.requestId}`;
    case "claim":
      return `claim:${cb.confirm ? "c" : "n"}:${cb.claimId}`;
  }
}

export function decodeCallback(data: string | undefined): Callback | null {
  if (!data) return null;
  const parts = data.split(":");
  const id = parts[parts.length - 1];
  if (!UUID.test(id)) return null;
  if (parts.length === 2) {
    if (parts[0] === "me") return { action: "me", friendId: id };
    if (parts[0] === "paid") return { action: "paid", requestId: id };
    if (parts[0] === "snooze") return { action: "snooze", requestId: id };
    return null;
  }
  if (parts.length === 3) {
    if (parts[0] === "bind" && (parts[1] === "a" || parts[1] === "r")) return { action: "bind", approve: parts[1] === "a", bindingId: id };
    if (parts[0] === "claim" && (parts[1] === "c" || parts[1] === "n")) return { action: "claim", confirm: parts[1] === "c", claimId: id };
  }
  return null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `tg://user?id=` mention for a bound friend; plain name otherwise. */
export function mention(friend: Friend): string {
  const name = escapeHtml(friend.displayName);
  return friend.telegramUserId === null ? name : `<a href="tg://user?id=${friend.telegramUserId}">${name}</a>`;
}

export interface SplitLine {
  readonly friend: Friend;
  readonly amount: number;
  /** Shares of zero (or "pays nothing") are listed without a request. */
  readonly owes: boolean;
}

export interface SplitMessage {
  readonly text: string;
  readonly keyboard: InlineKeyboard;
}

export function buildSplitMessage(input: {
  readonly title: string;
  readonly total: number;
  readonly lines: readonly SplitLine[];
  readonly friendLinkUrl: string;
}): SplitMessage {
  const rows = input.lines.map((line) => `• ${mention(line.friend)}: ${formatSGD(line.amount)}${line.owes ? "" : " (settled)"}`);
  const text = [`<b>${escapeHtml(input.title)}</b> · ${formatSGD(input.total)}`, "", ...rows].join("\n");
  const keyboard = new InlineKeyboard();
  for (const line of input.lines) {
    if (line.friend.telegramUserId === null) {
      keyboard.text(`That's me (${line.friend.displayName})`, encodeCallback({ action: "me", friendId: line.friend.id })).row();
    }
  }
  keyboard.url("Get private reminders", input.friendLinkUrl);
  return { text, keyboard };
}

export function requestKeyboard(request: PaymentRequest): InlineKeyboard {
  return new InlineKeyboard()
    .text("I've paid", encodeCallback({ action: "paid", requestId: request.id }))
    .text("Remind me later", encodeCallback({ action: "snooze", requestId: request.id }));
}

export function bindingKeyboard(bindingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve", encodeCallback({ action: "bind", approve: true, bindingId }))
    .text("Reject", encodeCallback({ action: "bind", approve: false, bindingId }));
}

export function claimKeyboard(claimId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Confirm", encodeCallback({ action: "claim", confirm: true, claimId }))
    .text("Not received", encodeCallback({ action: "claim", confirm: false, claimId }));
}

export function telegramHandle(user: { username?: string; first_name?: string; id: number }): string {
  if (user.username) return `@${user.username}`;
  if (user.first_name) return user.first_name;
  return `user ${user.id}`;
}

export const TOAST = {
  notYourRequest: "This button belongs to someone else's share.",
  hostOnly: "Only the host can do that.",
  alreadyHandled: "Already handled.",
  unknown: "This button has expired.",
} as const;
