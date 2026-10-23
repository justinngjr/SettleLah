"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button, Field, Notice } from "@/app/_ui";

import { addCredit, recordPayment, type MoneyFormState } from "../_actions/payments";

export function RecordPaymentForm({ friendId, outstanding }: { friendId: string; outstanding: number }) {
  const [state, action, pending] = useActionState<MoneyFormState, FormData>(recordPayment, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-6">
      <input type="hidden" name="friendId" value={friendId} />
      <Field
        label="Amount received (SGD)"
        id="record-amount"
        name="amount"
        inputMode="decimal"
        defaultValue={(outstanding / 100).toFixed(2)}
        hint="Any extra becomes credit for next time."
        error={state.error ?? null}
      />
      {state.ok ? <Notice>Payment recorded.</Notice> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}

export function AddCreditForm({ friendId }: { friendId: string }) {
  const [state, action, pending] = useActionState<MoneyFormState, FormData>(addCredit, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-6">
      <input type="hidden" name="friendId" value={friendId} />
      <Field label="Credit amount (SGD)" id="credit-amount" name="amount" inputMode="decimal" placeholder="5.00" error={state.error ?? null} />
      <Field label="Note (optional)" id="credit-note" name="note" maxLength={200} placeholder="e.g. paid for the Grab" />
      {state.ok ? <Notice>Credit added.</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Adding…" : "Add credit"}
      </Button>
    </form>
  );
}
