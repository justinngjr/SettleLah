"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button, Field, Notice } from "@/app/_ui";
import type { Friend } from "@/server/db/friends";

import { addFriend, renameFriend, setFriendArchived, type FriendFormState } from "../_actions/friends";

export function AddFriendForm() {
  const [state, action, pending] = useActionState(addFriend, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="space-y-6">
      <Field label="Name" name="displayName" required maxLength={80} placeholder="e.g. Sarah" error={state.error ?? null} />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add friend"}
      </Button>
    </form>
  );
}

export function FriendRowActions({ friend }: { friend: Friend }) {
  const [renaming, setRenaming] = useState(false);
  const [state, action, pending] = useActionState(async (prev: FriendFormState, formData: FormData) => {
    const result = await renameFriend(prev, formData);
    if (result.ok) setRenaming(false);
    return result;
  }, {});

  if (renaming) {
    return (
      <form action={action} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="friendId" value={friend.id} />
        <Field
          label={`Rename ${friend.displayName}`}
          id={`rename-${friend.id}`}
          name="displayName"
          defaultValue={friend.displayName}
          required
          maxLength={80}
          className="min-w-48 flex-1"
          error={state.error ?? null}
        />
        <Button type="submit" variant="secondary" disabled={pending} arrow={false}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="tertiary" onClick={() => setRenaming(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-5 text-sm">
      <Button type="button" variant="tertiary" onClick={() => setRenaming(true)} aria-label={`Rename ${friend.displayName}`}>
        Rename
      </Button>
      <form action={setFriendArchived}>
        <input type="hidden" name="friendId" value={friend.id} />
        <input type="hidden" name="archived" value={friend.archived ? "false" : "true"} />
        <Button type="submit" variant="tertiary" aria-label={`${friend.archived ? "Restore" : "Archive"} ${friend.displayName}`}>
          {friend.archived ? "Restore" : "Archive"}
        </Button>
      </form>
    </div>
  );
}

export function ArchivedToggle({ friends }: { friends: Friend[] }) {
  const [open, setOpen] = useState(false);
  if (friends.length === 0) return null;
  return (
    <div className="space-y-6">
      <Button type="button" variant="tertiary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "Show"} {friends.length} archived
      </Button>
      {open ? (
        <ul className="divide-y divide-line">
          {friends.map((friend) => (
            <li key={friend.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <span className="text-ink-soft">{friend.displayName}</span>
              <FriendRowActions friend={friend} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TelegramStatus({ friend }: { friend: Friend }) {
  return <span className="label">{friend.telegramUserId !== null ? "Telegram linked" : "Not linked"}</span>;
}

export { Notice };
