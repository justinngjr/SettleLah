"use client";

import { useActionState, useState } from "react";

import { Button, Field, Label, Notice, SelectField } from "@/app/_ui";
import type { RecurringCadence } from "@/domain";
import type { Friend, RecurringExpense } from "@/server/db";

import { saveRecurring, setRecurringActive, type RecurringFormState } from "../_actions/recurring";
import { toDollars } from "../_lib/cents";
import { WEEKDAYS } from "../_lib/recurring-format";

export interface ChatOption {
  readonly telegramChatId: number;
  readonly title: string | null;
}

export interface RecurringFormProps {
  readonly hostId: string;
  readonly friends: readonly Friend[];
  readonly chats: readonly ChatOption[];
  /** Present when editing. */
  readonly expense?: RecurringExpense;
}

export function RecurringForm({ hostId, friends, chats, expense }: RecurringFormProps) {
  const [state, action, pending] = useActionState<RecurringFormState, FormData>(saveRecurring, {});
  const [cadence, setCadence] = useState<RecurringCadence>(expense?.cadence ?? "monthly");
  const chosen = new Map((expense?.participants ?? [{ id: hostId, weight: 1 }]).map((p) => [p.id, p.weight]));
  const [selected, setSelected] = useState<Set<string>>(new Set(chosen.keys()));
  const [weighted, setWeighted] = useState(expense ? expense.participants.some((p) => p.weight !== 1) : false);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const people = [{ id: hostId, displayName: "You" }, ...friends.map((f) => ({ id: f.id, displayName: f.displayName }))];
  const fieldError = (prefix: string) => (state.error?.startsWith(prefix) ? state.error : null);
  const otherError = state.error && !["Title", "Amount", "Day", "Participants", "Weights", "Telegram", "Cadence"].some((p) => state.error?.startsWith(p));

  return (
    <form action={action} className="space-y-10">
      {expense ? <input type="hidden" name="recurringExpenseId" value={expense.id} /> : null}

      <Field label="Title" name="title" required maxLength={120} defaultValue={expense?.title ?? ""} placeholder="e.g. Netflix" error={fieldError("Title")} />

      <Field
        label="Amount (SGD)"
        name="amount"
        inputMode="decimal"
        required
        defaultValue={expense ? toDollars(expense.amount) : ""}
        placeholder="17.90"
        hint="The full charge each time. Split by the weights below; leftover cents go to friends, never to you."
        error={fieldError("Amount")}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <SelectField label="Repeats" name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value as RecurringCadence)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </SelectField>
        {cadence === "monthly" ? (
          <SelectField label="Day of month" name="anchorDay" defaultValue={String(expense?.cadence === "monthly" ? expense.anchorDay : 1)}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
                {d > 28 ? " (or the last day)" : ""}
              </option>
            ))}
          </SelectField>
        ) : (
          <SelectField label="Day of week" name="anchorDay" defaultValue={String(expense?.cadence === "weekly" ? expense.anchorDay : 1)}>
            {WEEKDAYS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      {fieldError("Day") ? (
        <p role="alert" className="text-sm text-ink">
          {state.error}
        </p>
      ) : null}
      <p className="text-sm text-ink-mute">Runs at 9:00 am Singapore time on that day.</p>

      <fieldset className="space-y-4">
        <legend className="label">Who shares it</legend>
        <ul className="divide-y divide-line">
          {people.map((person) => {
            const on = selected.has(person.id);
            return (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <label className="flex items-center gap-3 text-ink">
                  <input
                    type="checkbox"
                    name="participant"
                    value={person.id}
                    checked={on}
                    onChange={(e) => toggle(person.id, e.target.checked)}
                    className="h-5 w-5"
                  />
                  {person.displayName}
                </label>
                {weighted && on ? (
                  <div className="flex items-center gap-3">
                    <Label htmlFor={`weight_${person.id}`}>Weight</Label>
                    <input
                      id={`weight_${person.id}`}
                      name={`weight_${person.id}`}
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      defaultValue={chosen.get(person.id) ?? 1}
                      className="field w-24"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {friends.length === 0 ? <p className="text-sm text-ink-mute">Add friends first; they appear here.</p> : null}
        <Button type="button" variant="tertiary" onClick={() => setWeighted((v) => !v)} aria-pressed={weighted}>
          {weighted ? "Split equally instead" : "Use weights (e.g. 2 for a couple)"}
        </Button>
        {fieldError("Participants") || fieldError("Weights") ? (
          <p role="alert" className="text-sm text-ink">
            {state.error}
          </p>
        ) : null}
      </fieldset>

      <SelectField
        label="Post each charge to a Telegram group (optional)"
        name="telegramChatId"
        defaultValue={expense?.telegramChatId === null || expense?.telegramChatId === undefined ? "" : String(expense.telegramChatId)}
        disabled={chats.length === 0}
      >
        <option value="">{chats.length === 0 ? "No linked groups yet (Settings › Telegram)" : "Don’t post"}</option>
        {chats.map((chat) => (
          <option key={chat.telegramChatId} value={chat.telegramChatId}>
            {chat.title ?? `Group ${chat.telegramChatId}`}
          </option>
        ))}
      </SelectField>
      {fieldError("Telegram") ? (
        <p role="alert" className="text-sm text-ink">
          {state.error}
        </p>
      ) : null}

      {otherError ? <Notice role="alert">{state.error}</Notice> : null}
      {state.ok ? <Notice>Saved.</Notice> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : expense ? "Save changes" : "Start this recurring expense"}
      </Button>
    </form>
  );
}

export function PauseResumeForm({ expense }: { expense: RecurringExpense }) {
  return (
    <form action={setRecurringActive} className="space-y-3">
      <input type="hidden" name="recurringExpenseId" value={expense.id} />
      <input type="hidden" name="active" value={expense.active ? "false" : "true"} />
      <Button type="submit" variant="secondary" arrow={false}>
        {expense.active ? "Pause" : "Resume"}
      </Button>
      <p className="text-sm text-ink-mute">
        {expense.active
          ? "Pausing stops future charges. Past charges stay on your friends’ balances."
          : "Resuming schedules the next charge from today; paused periods are not back-charged."}
      </p>
    </form>
  );
}
