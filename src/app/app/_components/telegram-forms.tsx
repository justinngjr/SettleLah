"use client";

import { useActionState } from "react";

import { Button, Notice } from "@/app/_ui";

import { resolveBindingRequest, type TelegramFormState } from "../_actions/telegram";

export interface BindingView {
  readonly id: string;
  readonly friendName: string;
  readonly telegramUsername: string | null;
  readonly telegramFirstName: string | null;
  readonly viaPrivateChat: boolean;
  readonly createdAtLabel: string;
}

export function BindingRequestForm({ binding }: { binding: BindingView }) {
  const [state, action, pending] = useActionState<TelegramFormState, FormData>(resolveBindingRequest, {});
  if (state.done === "approved") return <Notice>Linked. {binding.friendName} now gets reminders in Telegram.</Notice>;
  if (state.done === "rejected") return <Notice>Rejected. {binding.friendName} stays unlinked.</Notice>;
  const who = binding.telegramUsername ? `@${binding.telegramUsername}` : (binding.telegramFirstName ?? "Someone");
  return (
    <form action={action} className="space-y-6 py-6">
      <input type="hidden" name="bindingId" value={binding.id} />
      <div className="space-y-2">
        <p className="text-ink">
          {who} says they are {binding.friendName}
        </p>
        <p className="label">
          {binding.viaPrivateChat ? "From a private chat with the bot" : "From a linked group"} · {binding.createdAtLabel}
        </p>
      </div>
      {state.error ? <Notice role="alert">{state.error}</Notice> : null}
      <div className="flex flex-wrap gap-4">
        <Button type="submit" name="decision" value="approve" disabled={pending}>
          {pending ? "Saving…" : "Approve"}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" arrow={false} disabled={pending}>
          Reject
        </Button>
      </div>
    </form>
  );
}
