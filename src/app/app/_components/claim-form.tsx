"use client";

import { useActionState } from "react";

import { Button, Field, Notice } from "@/app/_ui";

import { resolveClaim, type MoneyFormState } from "../_actions/payments";

export interface ClaimView {
  readonly id: string;
  readonly friendId: string;
  readonly friendName: string;
  readonly reference: string;
  readonly requestAmount: number;
  readonly claimedAmount: number | null;
  readonly claimedAt: string;
  readonly source: "friend_button" | "bank_alert";
}

export function ClaimForm({ claim, amountLabel, claimedAtLabel }: { claim: ClaimView; amountLabel: string; claimedAtLabel: string }) {
  const [state, action, pending] = useActionState<MoneyFormState, FormData>(resolveClaim, {});
  if (state.ok) return <Notice>Done. {claim.friendName}&apos;s balance has been updated.</Notice>;

  return (
    <form action={action} className="space-y-6 py-6">
      <input type="hidden" name="claimId" value={claim.id} />
      <input type="hidden" name="friendId" value={claim.friendId} />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="text-ink">
            {claim.friendName} says they paid {claim.source === "friend_button" ? "via the Telegram button" : "(bank alert)"}
          </p>
          <p className="label mt-2">
            {claim.reference} · {claimedAtLabel}
          </p>
        </div>
        <span className="amount">{amountLabel}</span>
      </div>
      <Field
        label="Received a different amount? (optional)"
        id={`amount-${claim.id}`}
        name="amount"
        inputMode="decimal"
        placeholder={(claim.requestAmount / 100).toFixed(2)}
        hint="Leave blank to confirm the amount above."
        error={state.error ?? null}
      />
      <div className="flex flex-wrap gap-4">
        <Button type="submit" name="decision" value="confirm" disabled={pending}>
          {pending ? "Saving…" : "Confirm payment"}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" arrow={false} disabled={pending}>
          Reject
        </Button>
      </div>
    </form>
  );
}
