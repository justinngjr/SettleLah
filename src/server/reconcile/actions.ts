import "server-only";

import type { DbClient, PaymentRequest, Tables } from "@/server/db";
import { confirmPaymentClaim, createPaymentClaim } from "@/server/db";
import { unwrap } from "@/server/db/errors";

import { addKnownBankName, getBankAlert, updateBankAlert, type BankAlert } from "./store";
import { ReconcileError } from "./types";

export interface ConfirmBankAlertInput {
  /** Overrides the proposed request (reassign + confirm in one tap). Must be `open` and belong to the host. */
  readonly paymentRequestId?: string | null;
}

export interface ConfirmBankAlertResult {
  readonly alert: BankAlert;
  readonly claimId: string;
  readonly ledgerEventId: string;
  readonly paymentRequest: PaymentRequest;
}

async function getOpenRequest(db: DbClient, hostId: string, requestId: string): Promise<PaymentRequest> {
  const row = unwrap<Tables<"payment_requests">>(
    await db.from("payment_requests").select("*").eq("host_id", hostId).eq("id", requestId).maybeSingle(),
    "getOpenRequest",
  );
  if (!row) throw new ReconcileError("not_found", `payment request ${requestId} not found`);
  if (row.status !== "open") throw new ReconcileError("invalid_state", `payment request ${requestId} is ${row.status}`);
  return {
    id: row.id,
    hostId: row.host_id,
    friendId: row.friend_id,
    amount: row.amount,
    reference: row.reference,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    cancelledAt: row.cancelled_at,
  };
}

async function getActionableAlert(db: DbClient, hostId: string, alertId: string): Promise<BankAlert> {
  const alert = await getBankAlert(db, hostId, alertId);
  if (!alert) throw new ReconcileError("not_found", `bank alert ${alertId} not found`);
  if (alert.status === "confirmed") throw new ReconcileError("invalid_state", "bank alert is already confirmed");
  return alert;
}

/**
 * The host's one tap: creates a `bank_alert` payment claim for the alert's
 * amount and confirms it, so `confirm_payment_claim` writes exactly one
 * `payment` ledger event for the amount actually received (overpayment ->
 * credit, underpayment -> request stays open) and marks the alert
 * `confirmed`, all in one transaction. Then remembers the payer's bank name
 * for the friend.
 */
export async function confirmBankAlert(
  db: DbClient,
  hostId: string,
  alertId: string,
  input: ConfirmBankAlertInput,
): Promise<ConfirmBankAlertResult> {
  const alert = await getActionableAlert(db, hostId, alertId);
  if (alert.amount <= 0) throw new ReconcileError("invalid_state", "bank alert has no amount to confirm");
  const requestId = input.paymentRequestId ?? alert.proposedPaymentRequestId;
  if (!requestId) throw new ReconcileError("invalid_input", "paymentRequestId is required for an unmatched alert");
  const request = await getOpenRequest(db, hostId, requestId);

  if (request.id !== alert.proposedPaymentRequestId || request.friendId !== alert.proposedFriendId) {
    await updateBankAlert(db, hostId, alert.id, {
      status: "proposed",
      reason: null,
      proposed_friend_id: request.friendId,
      proposed_payment_request_id: request.id,
      match_confidence: null,
      match_reason: "host",
    });
  }

  const claim = await createPaymentClaim(db, hostId, {
    paymentRequestId: request.id,
    source: "bank_alert",
    bankAlertId: alert.id,
    amount: alert.amount,
  });
  const ledgerEventId = await confirmPaymentClaim(db, claim.id, alert.amount);
  await addKnownBankName(db, hostId, request.friendId, alert.payerName);

  const confirmed = await getBankAlert(db, hostId, alert.id);
  return { alert: confirmed ?? alert, claimId: claim.id, ledgerEventId, paymentRequest: request };
}

/** Points a proposed/unmatched/ignored alert at another open request (and so another friend). Nothing hits the ledger. */
export async function reassignBankAlert(db: DbClient, hostId: string, alertId: string, paymentRequestId: string): Promise<BankAlert> {
  const alert = await getActionableAlert(db, hostId, alertId);
  const request = await getOpenRequest(db, hostId, paymentRequestId);
  return updateBankAlert(db, hostId, alert.id, {
    status: "proposed",
    reason: null,
    proposed_friend_id: request.friendId,
    proposed_payment_request_id: request.id,
    match_confidence: null,
    match_reason: "host",
  });
}

export const HOST_IGNORED_REASON = "host_ignored";

/** The host dismisses the alert. Keeps the parsed fields and hash so a re-delivery stays a duplicate. */
export async function ignoreBankAlert(db: DbClient, hostId: string, alertId: string, reason?: string | null): Promise<BankAlert> {
  const alert = await getActionableAlert(db, hostId, alertId);
  return updateBankAlert(db, hostId, alert.id, {
    status: "ignored",
    reason: reason?.trim() || HOST_IGNORED_REASON,
    proposed_friend_id: null,
    proposed_payment_request_id: null,
    match_confidence: null,
    match_reason: alert.matchReason,
  });
}
