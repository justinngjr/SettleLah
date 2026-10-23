"use client";

import { useMemo, useState, useTransition } from "react";

import { Button, DisabledReason, Field, Notice, Section } from "@/app/_ui";

import { saveReceipt } from "../../_actions/receipts";
import { computeDraft, confirmBlockers, toSavePayload, type ReceiptDraft } from "../../_lib/receipt-draft";
import { ItemEditor } from "./item-editor";
import { SplitSummary } from "./summary";

export interface ConfirmScreenProps {
  readonly draft: ReceiptDraft;
  readonly hostId: string;
  readonly onChange: (next: ReceiptDraft) => void;
  readonly onBack: () => void;
  readonly onSaved: (receiptId: string) => void;
  /** Injected so tests can avoid the real server action. */
  readonly save?: typeof saveReceipt;
}

export function ConfirmScreen({ draft, hostId, onChange, onBack, onSaved, save = saveReceipt }: ConfirmScreenProps) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const computation = useMemo(() => computeDraft(draft, hostId), [draft, hostId]);
  const blockers = confirmBlockers(draft, computation);
  const canConfirm = blockers.length === 0 && computation.ok && !pending;

  const toggleQuestion = (index: number) =>
    onChange({
      ...draft,
      acknowledged: draft.acknowledged.includes(index) ? draft.acknowledged.filter((i) => i !== index) : [...draft.acknowledged, index],
    });

  const confirm = () => {
    if (!computation.ok) return;
    const payload = toSavePayload(draft, computation.split);
    setError(null);
    startTransition(async () => {
      const result = await save(payload);
      if (result.ok) onSaved(result.receiptId);
      else setError(result.error);
    });
  };

  return (
    <div className="space-y-16">
      <Section title="Review the split">
        {computation.ok ? (
          <SplitSummary split={computation.split} participants={draft.participants} />
        ) : (
          <Notice role="alert">{computation.error}</Notice>
        )}
      </Section>

      {draft.warnings.length > 0 ? (
        <Section title="Check these">
          <ul className="space-y-3">
            {draft.warnings.map((w, i) => (
              <li key={i} className="border-l border-line pl-4 text-ink-soft">
                {w}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {draft.questions.length > 0 ? (
        <Section title="Questions from the interpretation" meta={`${draft.acknowledged.length}/${draft.questions.length} handled`}>
          <p className="measure text-ink-soft">Tick each one once you have checked or fixed it in the items below.</p>
          <ul className="space-y-4">
            {draft.questions.map((q, i) => {
              const checked = draft.acknowledged.includes(i);
              return (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-4">
                    <input
                      type="checkbox"
                      className="mt-1.5 size-5 shrink-0 accent-ink"
                      checked={checked}
                      onChange={() => toggleQuestion(i)}
                    />
                    <span className={checked ? "text-ink-mute line-through" : "text-ink"}>{q}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {draft.assumptions.length > 0 ? (
        <Section title="Assumptions made">
          <ul className="space-y-3">
            {draft.assumptions.map((a, i) => (
              <li key={i} className="text-ink-soft">
                {a}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Items and who shares them">
        {editing ? (
          <>
            <ItemEditor draft={draft} onChange={onChange} />
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Done editing
            </Button>
          </>
        ) : (
          <>
            {draft.title ? <p className="text-ink">{draft.title}</p> : null}
            <ul className="divide-y divide-line">
              {draft.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-6 py-3">
                  <span>
                    {item.label || <span className="text-ink-mute">Untitled item</span>}
                    <span className="block text-sm text-ink-mute">
                      {item.sharedBy.map((id) => draft.participants.find((p) => p.id === id)?.name ?? id).join(", ") || "nobody"}
                    </span>
                  </span>
                  <span className="amount">{(item.price / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Edit items
            </Button>
          </>
        )}
      </Section>

      <Section>
        {!draft.title.trim() ? (
          <Field
            label="Title"
            id="confirm-title"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="e.g. Friday dinner"
            maxLength={120}
          />
        ) : null}
        {error ? <Notice role="alert">{error}</Notice> : null}
        <div className="flex flex-wrap items-center gap-6">
          <Button type="button" onClick={confirm} disabled={!canConfirm} aria-describedby={blockers.length > 0 ? "confirm-blockers" : undefined}>
            {pending ? "Saving…" : "Confirm and save"}
          </Button>
          <Button type="button" variant="tertiary" onClick={onBack} disabled={pending}>
            Back
          </Button>
        </div>
        {blockers.length > 0 ? (
          <div id="confirm-blockers">
            {blockers.map((b, i) => (
              <DisabledReason key={i}>{b}</DisabledReason>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-mute">Saving records each share and opens one PayNow request per friend who owes you.</p>
        )}
      </Section>
    </div>
  );
}
