"use client";

import Link from "next/link";

import { Button, cx } from "@/app/_ui";

import type { ActionDto } from "../_lib/types";

export interface ActionCardProps {
  readonly action: ActionDto;
  readonly busy: boolean;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
}

export function stateText(action: ActionDto): string {
  if (action.needsReapproval) return "Needs re-approval: the details changed since this card was made.";
  switch (action.status) {
    case "pending":
      return "Pending your approval";
    case "approved":
      return "Running…";
    case "executed":
      return "Executed";
    case "rejected":
      return "Rejected";
    case "failed":
      return action.error ? `Failed: ${action.error}` : "Failed";
    case "expired":
      return "Expired: cards last 30 minutes. Ask again if you still want this.";
  }
}

export function ActionCard({ action, busy, onApprove, onReject }: ActionCardProps) {
  const { preview } = action;
  const open = action.status === "pending";
  const settled = action.status === "executed";
  return (
    <article
      data-testid="action-card"
      data-status={action.status}
      className={cx("space-y-5 rounded-xl border border-line bg-paper-raised p-5 sm:p-6", !open && !settled && "text-ink-soft")}
      aria-label={preview.title}
    >
      <header className="space-y-2">
        <p className="label">Action</p>
        <h3 className="heading">{preview.title}</h3>
        <p className="text-sm text-ink-soft">{preview.summary}</p>
      </header>

      {preview.rows.length > 0 ? (
        <dl className="divide-y divide-line">
          {preview.rows.map((row) => (
            <div key={row.label} className={cx("flex items-baseline justify-between gap-6 py-2", row.strong && "text-lg")}>
              <dt className={row.strong ? "text-ink" : "text-ink-soft"}>{row.label}</dt>
              <dd className="amount text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {preview.shares && preview.shares.length > 0 ? (
        <div className="space-y-2">
          <p className="label">Each person</p>
          <ul className="divide-y divide-line">
            {preview.shares.map((share) => (
              <li key={share.participantId} className="flex items-baseline justify-between gap-6 py-2">
                <span className={share.paysNothing ? "text-ink-mute" : "text-ink"}>{share.name}</span>
                <span className="amount">{share.paysNothing ? "pays nothing" : share.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.warnings && preview.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink-soft">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3 pt-1">
        {open ? (
          <>
            <Button variant="primary" onClick={() => onApprove(action.id)} disabled={busy}>
              {action.needsReapproval ? "Approve again" : "Approve"}
            </Button>
            <Button variant="secondary" arrow={false} onClick={() => onReject(action.id)} disabled={busy}>
              Reject
            </Button>
          </>
        ) : null}
        <p className="label" aria-live="polite">
          {stateText(action)}
        </p>
        {preview.openInApp ? (
          <Link href={preview.openInApp} className="ml-auto text-sm underline underline-offset-4">
            Open in app →
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
