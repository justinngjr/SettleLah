"use client";

import { Button, Field, Label, SelectField } from "@/app/_ui";

import { parseDollars, toDollars } from "../../_lib/cents";
import {
  CHARGE_LABELS,
  newItemId,
  type ChargeChoice,
  type DraftItem,
  type DraftParticipant,
  type ReceiptDraft,
} from "../../_lib/receipt-draft";

const CHIP = "motion inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";
const CHIP_ON = "border-ink bg-ink text-paper";
const CHIP_OFF = "border-line text-ink";

function ParticipantChips({
  participants,
  selected,
  onToggle,
}: {
  participants: readonly DraftParticipant[];
  selected: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {participants.map((p) => {
        const on = selected.includes(p.id);
        return (
          <label key={p.id} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(p.id)} />
            {p.name}
            {p.isHost ? " (you)" : ""}
          </label>
        );
      })}
    </div>
  );
}

function ItemRow({
  item,
  index,
  participants,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  participants: readonly DraftParticipant[];
  onChange: (item: DraftItem) => void;
  onRemove: () => void;
}) {
  const toggle = (id: string) => {
    const sharedBy = item.sharedBy.includes(id) ? item.sharedBy.filter((p) => p !== id) : [...item.sharedBy, id];
    const { weights, ...rest } = item;
    void weights;
    onChange({ ...rest, sharedBy });
  };
  const n = index + 1;
  return (
    <li className="space-y-5 py-6">
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <Field
          label={`Item ${n}`}
          id={`item-${item.id}-label`}
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          placeholder="e.g. Chicken rice"
        />
        <Field
          label="Price (SGD)"
          id={`item-${item.id}-price`}
          inputMode="decimal"
          defaultValue={item.price === 0 ? "" : toDollars(item.price)}
          onBlur={(e) => {
            const cents = parseDollars(e.target.value);
            if (cents !== null) {
              onChange({ ...item, price: cents });
              e.target.value = toDollars(cents);
            }
          }}
          placeholder="0.00"
        />
        <Button type="button" variant="tertiary" onClick={onRemove} aria-label={`Remove item ${n}`} className="justify-self-start sm:mb-3">
          Remove
        </Button>
      </div>
      <fieldset className="space-y-3">
        <legend className="label">Shared by</legend>
        <ParticipantChips participants={participants} selected={item.sharedBy} onToggle={toggle} />
        {item.sharedBy.length === 0 ? (
          <p role="alert" className="text-sm text-ink-soft">
            Nobody is sharing this item yet.
          </p>
        ) : null}
        {item.weights ? <p className="text-sm text-ink-mute">Weighted split from the interpretation; untick anyone to reset to equal.</p> : null}
      </fieldset>
    </li>
  );
}

export function ItemEditor({ draft, onChange }: { draft: ReceiptDraft; onChange: (next: ReceiptDraft) => void }) {
  const update = (patch: Partial<ReceiptDraft>) => onChange({ ...draft, ...patch });
  const setItem = (id: string, item: DraftItem) => update({ items: draft.items.map((i) => (i.id === id ? item : i)) });
  const addItem = () =>
    update({ items: [...draft.items, { id: newItemId(), label: "", price: 0, sharedBy: draft.participants.map((p) => p.id) }] });

  return (
    <div className="space-y-12">
      <Field
        label="Title"
        id="receipt-title"
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="e.g. Friday dinner at Ah Hua"
        maxLength={120}
      />

      <div className="space-y-2">
        <p className="label">Items</p>
        {draft.items.length === 0 ? <p className="py-4 text-ink-soft">No items yet.</p> : null}
        <ul className="divide-y divide-line">
          {draft.items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              participants={draft.participants}
              onChange={(next) => setItem(item.id, next)}
              onRemove={() => update({ items: draft.items.filter((i) => i.id !== item.id) })}
            />
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={addItem}>
          Add item
        </Button>
      </div>

      <div className="grid gap-10 md:grid-cols-2">
        <SelectField label="Charges" id="charges" value={draft.charges} onChange={(e) => update({ charges: e.target.value as ChargeChoice })}>
          {(Object.keys(CHARGE_LABELS) as ChargeChoice[]).map((key) => (
            <option key={key} value={key}>
              {CHARGE_LABELS[key]}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Someone is treating everyone"
          id="treated-by"
          value={draft.treatedBy ?? ""}
          onChange={(e) => update({ treatedBy: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">Nobody; everyone pays their share</option>
          {draft.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isHost ? " (you)" : ""} pays for everyone
            </option>
          ))}
        </SelectField>
      </div>

      <fieldset className="space-y-4">
        <legend className="label">Pays nothing (e.g. the birthday person)</legend>
        <ParticipantChips
          participants={draft.participants}
          selected={draft.excluded}
          onToggle={(id) => update({ excluded: draft.excluded.includes(id) ? draft.excluded.filter((x) => x !== id) : [...draft.excluded, id] })}
        />
        {draft.excluded.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="redistribute">Their share goes to the others</Label>
            <select
              id="redistribute"
              className="field"
              value={draft.redistribute}
              onChange={(e) => update({ redistribute: e.target.value as ReceiptDraft["redistribute"] })}
            >
              <option value="proportional">In proportion to what each person ordered</option>
              <option value="equal">Equally</option>
            </select>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
