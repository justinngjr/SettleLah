import "server-only";

import type { Cents } from "@/domain";
import { getFriend, listPaymentRequests, type DbClient } from "@/server/db";
import { confirmBankAlert, ignoreBankAlert, listBankAlerts, reassignBankAlert, type BankAlert } from "@/server/reconcile";

/**
 * Bank-alert proposals for the inbox: forwarded DBS/POSB incoming-transfer
 * emails the matcher could (or could not) pair with an open payment request.
 * Nothing here changes a balance until the host confirms.
 */
export interface BankProposal {
  readonly id: string;
  readonly bank: string;
  readonly amount: Cents;
  readonly payerName: string | null;
  readonly reference: string | null;
  readonly receivedAt: string;
  readonly status: BankAlert["status"];
  readonly proposedFriendId: string | null;
  readonly proposedFriendName: string | null;
  readonly proposedPaymentRequestId: string | null;
  readonly proposedRequestReference: string | null;
  readonly confidence: "strong" | "weak" | null;
  /** Why the matcher proposed this (or why it could not match). */
  readonly reason: string | null;
}

export interface BankProposalSource {
  list(db: DbClient, hostId: string): Promise<BankProposal[]>;
  confirm(db: DbClient, hostId: string, proposalId: string, paymentRequestId?: string | null): Promise<void>;
  reassign(db: DbClient, hostId: string, proposalId: string, paymentRequestId: string): Promise<void>;
  ignore(db: DbClient, hostId: string, proposalId: string): Promise<void>;
}

/** Human wording for the matcher's `match_reason` / `reason` codes. */
export function describeMatchReason(code: string | null): string | null {
  if (!code) return null;
  const known: Record<string, string> = {
    reference_exact: "the transfer reference matches this request exactly",
    reference_and_amount: "reference and amount both match",
    amount_and_known_name: "amount matches and this payer name is already known for the friend",
    amount_only: "only the amount matches",
    known_name: "the payer name is known for this friend",
    ambiguous: "several open requests have this amount",
    no_open_request: "no open request has this amount",
    parse_failed: "the email could not be read as a DBS/POSB alert",
    sender_not_verified: "the original sender is not on the allowlist",
  };
  return known[code] ?? code.replaceAll("_", " ");
}

export const bankProposals: BankProposalSource = {
  async list(db, hostId) {
    const [alerts, requests] = await Promise.all([
      listBankAlerts(db, hostId, { status: ["proposed", "unmatched"], limit: 50 }),
      listPaymentRequests(db, hostId),
    ]);
    const requestById = new Map(requests.map((r) => [r.id, r]));
    const friendIds = [...new Set(alerts.map((a) => a.proposedFriendId).filter((id): id is string => id !== null))];
    const friends = await Promise.all(friendIds.map((id) => getFriend(db, hostId, id)));
    const friendName = new Map(friends.flatMap((f) => (f ? [[f.id, f.displayName] as const] : [])));
    return alerts.map((a) => ({
      id: a.id,
      bank: a.bank,
      amount: a.amount,
      payerName: a.payerName,
      reference: a.reference,
      receivedAt: a.receivedAt,
      status: a.status,
      proposedFriendId: a.proposedFriendId,
      proposedFriendName: a.proposedFriendId ? (friendName.get(a.proposedFriendId) ?? null) : null,
      proposedPaymentRequestId: a.proposedPaymentRequestId,
      proposedRequestReference: a.proposedPaymentRequestId ? (requestById.get(a.proposedPaymentRequestId)?.reference ?? null) : null,
      confidence: a.matchConfidence,
      reason: a.matchReason ?? a.reason,
    }));
  },
  async confirm(db, hostId, proposalId, paymentRequestId) {
    await confirmBankAlert(db, hostId, proposalId, paymentRequestId ? { paymentRequestId } : {});
  },
  async reassign(db, hostId, proposalId, paymentRequestId) {
    await reassignBankAlert(db, hostId, proposalId, paymentRequestId);
  },
  async ignore(db, hostId, proposalId) {
    await ignoreBankAlert(db, hostId, proposalId, "host_ignored");
  },
};
