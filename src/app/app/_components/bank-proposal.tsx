"use client";

import { useActionState, useState } from "react";

import { Button, Notice, SelectField } from "@/app/_ui";

import { resolveBankProposal, type BankFormState } from "../_actions/bank";

export interface RequestOption {
  readonly id: string;
  readonly friendId: string;
  readonly friendName: string;
  readonly amountLabel: string;
  readonly reference: string;
}

export interface BankProposalView {
  readonly id: string;
  readonly bank: string;
  readonly amountLabel: string;
  readonly payerName: string | null;
  readonly reference: string | null;
  readonly receivedAtLabel: string;
  readonly proposedFriendId: string | null;
  readonly proposedFriendName: string | null;
  readonly proposedPaymentRequestId: string | null;
  readonly proposedRequestReference: string | null;
  readonly confidence: "strong" | "weak" | null;
  readonly reasonLabel: string | null;
}

const DONE: Record<NonNullable<BankFormState["done"]>, string> = {
  confirmed: "Payment recorded. The friend’s balance has been updated.",
  reassigned: "Reassigned. Confirm it when you are sure.",
  ignored: "Ignored. It will not be proposed again.",
};

export function BankProposalForm({ proposal, requests }: { proposal: BankProposalView; requests: readonly RequestOption[] }) {
  const [state, action, pending] = useActionState<BankFormState, FormData>(resolveBankProposal, {});
  const [reassigning, setReassigning] = useState(false);
  const [friendId, setFriendId] = useState(proposal.proposedFriendId ?? requests[0]?.friendId ?? "");
  const friends = [...new Map(requests.map((r) => [r.friendId, r.friendName])).entries()];
  const forFriend = requests.filter((r) => r.friendId === friendId);

  if (state.done) return <Notice>{DONE[state.done]}</Notice>;

  const matched = proposal.proposedFriendName
    ? `${proposal.proposedFriendName}${proposal.proposedRequestReference ? ` · ${proposal.proposedRequestReference}` : ""}`
    : "no match";

  return (
    <form action={action} className="space-y-6 py-6">
      <input type="hidden" name="proposalId" value={proposal.id} />
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="space-y-2">
          <p className="text-ink">
            {proposal.payerName ?? "Unknown payer"} → {matched}
          </p>
          <p className="label">
            {proposal.bank}
            {proposal.reference ? ` · ref ${proposal.reference}` : ""} · {proposal.receivedAtLabel}
          </p>
          <p className="text-sm text-ink-soft">
            {proposal.confidence === "strong" ? "Strong match" : proposal.confidence === "weak" ? "Weak match" : "Unmatched"}
            {proposal.reasonLabel ? `: ${proposal.reasonLabel}` : ""}
          </p>
        </div>
        <span className="amount">{proposal.amountLabel}</span>
      </div>

      {reassigning ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField label="Friend" id={`friend-${proposal.id}`} name="friendId" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
            {friends.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Open request" id={`request-${proposal.id}`} name="paymentRequestId" defaultValue={forFriend[0]?.id ?? ""}>
            {forFriend.map((r) => (
              <option key={r.id} value={r.id}>
                {r.reference} · {r.amountLabel}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}

      {state.error ? <Notice role="alert">{state.error}</Notice> : null}

      <div className="flex flex-wrap gap-4">
        {reassigning ? (
          <>
            <Button type="submit" name="decision" value="confirm" disabled={pending || forFriend.length === 0}>
              {pending ? "Saving…" : "Reassign and confirm"}
            </Button>
            <Button type="submit" name="decision" value="reassign" variant="secondary" arrow={false} disabled={pending || forFriend.length === 0}>
              Reassign only
            </Button>
            <Button type="button" variant="tertiary" onClick={() => setReassigning(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="confirm" disabled={pending || !proposal.proposedPaymentRequestId}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
            <Button type="button" variant="secondary" arrow={false} onClick={() => setReassigning(true)} disabled={requests.length === 0}>
              Reassign
            </Button>
            <Button type="submit" name="decision" value="ignore" variant="tertiary" disabled={pending}>
              Ignore
            </Button>
          </>
        )}
      </div>
      {!proposal.proposedPaymentRequestId && !reassigning ? (
        <p className="text-sm text-ink-mute">No request matched, so there is nothing to confirm yet. Reassign it to a friend’s request or ignore it.</p>
      ) : null}
      {requests.length === 0 ? <p className="text-sm text-ink-mute">No open requests to reassign to.</p> : null}
    </form>
  );
}
