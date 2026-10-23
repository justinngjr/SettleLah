import "server-only";

import {
  canAutoConfirm,
  matchBankAlert,
  type AlertForMatch,
  type FriendForMatch,
  type MatchProposal,
  type OpenRequestForMatch,
} from "@/domain";
import type { DbClient } from "@/server/db";
import { listFriends, listPaymentRequests } from "@/server/db";

import { confirmBankAlert } from "./actions";
import type { InboundEmailConfig } from "./config";
import { extractToken, rawHash, verifiedBankSender } from "./email";
import { BANK_ALERT_PARSERS, findParser } from "./parsers";
import {
  findBankAlertByHash,
  findRouteByToken,
  getReconcileSettings,
  insertBankAlert,
  type BankAlert,
  type NewBankAlert,
} from "./store";
import { ParseError, ReconcileError, type BankAlertParser, type InboundEmail } from "./types";

export type IngestOutcome = "duplicate" | "ignored" | "unmatched" | "proposed" | "confirmed";

export interface IngestResult {
  readonly outcome: IngestOutcome;
  readonly alert: BankAlert;
  /** Set when `confirmed` (auto-confirm). */
  readonly ledgerEventId?: string;
}

export interface IngestOptions {
  readonly parsers?: readonly BankAlertParser[];
  readonly now?: () => Date;
}

/** Reasons stored in `bank_alerts.reason`. */
export const INGEST_REASONS = {
  senderNotVerified: "sender_not_verified",
  unsupportedFormat: "unsupported_format",
  parseFailed: "parse_failed",
} as const;

function proposalColumns(proposal: MatchProposal): Pick<
  NewBankAlert,
  "status" | "reason" | "proposed_friend_id" | "proposed_payment_request_id" | "match_confidence" | "match_reason"
> {
  if (proposal.kind === "proposed") {
    return {
      status: "proposed",
      reason: null,
      proposed_friend_id: proposal.friendId,
      proposed_payment_request_id: proposal.paymentRequestId,
      match_confidence: proposal.confidence,
      match_reason: proposal.reason,
    };
  }
  return {
    status: "unmatched",
    reason: proposal.reason,
    proposed_friend_id: null,
    proposed_payment_request_id: null,
    match_confidence: null,
    match_reason: proposal.tier ?? null,
  };
}

/**
 * Processes one forwarded email for the host that owns the `to` token.
 *
 * Never stores the raw email: only the parsed fields, the sender, the subject
 * and the sha256 hash used for idempotency. Every query after the token
 * lookup is filtered by the resolved host id. Nothing here throws for a bad
 * *email* (the alert is stored as `ignored` / `unmatched` with a reason);
 * `ReconcileError("not_found")` is thrown for an unknown or revoked token.
 */
export async function ingestInboundEmail(
  db: DbClient,
  config: InboundEmailConfig,
  email: InboundEmail,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const token = extractToken(email.to, config.domain);
  if (!token) throw new ReconcileError("not_found", `no recipient at ${config.domain}`);
  const route = await findRouteByToken(db, token);
  if (!route) throw new ReconcileError("not_found", "unknown or revoked forwarding address");
  const hostId = route.hostId;

  const hash = rawHash(email);
  const existing = await findBankAlertByHash(db, hostId, hash);
  if (existing) return { outcome: "duplicate", alert: existing };

  const now = options.now ?? (() => new Date());
  const subject = email.subject.slice(0, 200);
  const base = { raw_hash: hash, subject, received_at: now().toISOString() };

  const sender = verifiedBankSender(email, config.senderAllowlist);
  if (!sender) {
    return stored(
      await insertBankAlert(db, hostId, {
        ...base,
        bank: "unknown",
        amount: 0,
        sender: null,
        status: "ignored",
        reason: INGEST_REASONS.senderNotVerified,
      }),
    );
  }

  const parser = findParser(email, options.parsers ?? BANK_ALERT_PARSERS);
  if (!parser) {
    return stored(
      await insertBankAlert(db, hostId, {
        ...base,
        bank: "unknown",
        amount: 0,
        sender,
        status: "ignored",
        reason: INGEST_REASONS.unsupportedFormat,
      }),
    );
  }

  let parsed;
  try {
    parsed = parser.parse(email);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return stored(
      await insertBankAlert(db, hostId, {
        ...base,
        bank: parser.bank,
        amount: 0,
        sender,
        status: "unmatched",
        reason: INGEST_REASONS.parseFailed,
        match_reason: error.message.slice(0, 200),
      }),
    );
  }

  const [requests, friends] = await Promise.all([
    listPaymentRequests(db, hostId, { status: "open" }),
    listFriends(db, hostId),
  ]);
  const alertForMatch: AlertForMatch = { amount: parsed.amount, payerName: parsed.payerName, reference: parsed.reference };
  const openRequests: OpenRequestForMatch[] = requests.map((r) => ({
    id: r.id,
    friendId: r.friendId,
    amount: r.amount,
    reference: r.reference,
  }));
  const friendsForMatch: FriendForMatch[] = friends.map((f) => ({ id: f.id, knownBankNames: f.knownBankNames }));
  const proposal = matchBankAlert(alertForMatch, openRequests, friendsForMatch);

  const inserted = await insertBankAlert(db, hostId, {
    ...base,
    bank: parser.bank,
    received_at: parsed.receivedAt.toISOString(),
    amount: parsed.amount,
    payer_name: parsed.payerName,
    reference: parsed.reference,
    sender,
    ...proposalColumns(proposal),
  });
  if (inserted.duplicate) return { outcome: "duplicate", alert: inserted.alert };

  if (proposal.kind === "proposed") {
    const request = openRequests.find((r) => r.id === proposal.paymentRequestId);
    const friend = friendsForMatch.find((f) => f.id === proposal.friendId);
    if (request && friend && canAutoConfirm(alertForMatch, proposal, request, friend)) {
      const settings = await getReconcileSettings(db, hostId);
      if (settings.autoConfirmBankAlerts) {
        const confirmed = await confirmBankAlert(db, hostId, inserted.alert.id, {});
        return { outcome: "confirmed", alert: confirmed.alert, ledgerEventId: confirmed.ledgerEventId };
      }
    }
    return { outcome: "proposed", alert: inserted.alert };
  }
  return { outcome: "unmatched", alert: inserted.alert };
}

function stored(result: { alert: BankAlert; duplicate: boolean }): IngestResult {
  if (result.duplicate) return { outcome: "duplicate", alert: result.alert };
  return { outcome: result.alert.status === "ignored" ? "ignored" : "unmatched", alert: result.alert };
}
