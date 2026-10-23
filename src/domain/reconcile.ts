/**
 * Bank-alert reconciliation: given a parsed incoming-transfer alert and the
 * host's open payment requests + friends, propose who paid which request.
 *
 * Pure and deterministic. The output is a *proposal*: the server stores it on
 * the alert and the host confirms (or the narrow `canAutoConfirm` case fires
 * when the host opted in). The matcher never guesses between equally good
 * candidates: ties are `unmatched` with reason `ambiguous`.
 */

import type { Cents } from "./money";

export interface AlertForMatch {
  /** Amount received, in cents. */
  readonly amount: Cents;
  /** Payer name as printed by the bank (legal name, usually caps); null if the alert had none. */
  readonly payerName: string | null;
  /** Free-text reference / "Other info" the payer typed; null if absent. */
  readonly reference: string | null;
}

export interface OpenRequestForMatch {
  readonly id: string;
  readonly friendId: string;
  readonly amount: Cents;
  /** `SLxxxxxx` payment reference printed on the PayNow QR. */
  readonly reference: string;
}

export interface FriendForMatch {
  readonly id: string;
  /** Bank names the host already confirmed for this friend. */
  readonly knownBankNames: readonly string[];
}

export type MatchConfidence = "strong" | "weak";

export type MatchReason =
  /** The alert reference carries exactly one open request's reference. */
  | "reference"
  /** The payer is a known bank name of exactly one friend with one open request for this amount. */
  | "known_name_and_amount"
  /** Exactly one open request (any friend) is for this amount. */
  | "amount_only";

export type UnmatchedReason = "no_candidates" | "ambiguous";

export interface MatchCandidate {
  readonly friendId: string;
  readonly paymentRequestId: string;
}

export type MatchProposal =
  | {
      readonly kind: "proposed";
      readonly friendId: string;
      readonly paymentRequestId: string;
      readonly confidence: MatchConfidence;
      readonly reason: MatchReason;
    }
  | {
      readonly kind: "unmatched";
      readonly reason: UnmatchedReason;
      /** The tied candidates when `ambiguous`, empty when `no_candidates`. */
      readonly candidates: readonly MatchCandidate[];
      /** Which tier produced the tie, when `ambiguous`. */
      readonly tier?: MatchReason;
    };

/**
 * Canonical form for comparing bank names: upper-case, punctuation removed,
 * whitespace collapsed. `"Tan  Ah-Kow"` and `"TAN AH KOW"` compare equal.
 */
export function normaliseBankName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alphanumeric tokens of a free-text reference, upper-cased (`"slk7m2qx dinner"` -> `["SLK7M2QX", "DINNER"]`). */
export function referenceTokens(reference: string | null | undefined): readonly string[] {
  if (!reference) return [];
  return reference
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0);
}

/** True if the alert's free-text reference is, or contains as a whole token, the request reference. */
export function referenceMatches(alertReference: string | null | undefined, requestReference: string): boolean {
  const wanted = requestReference.toUpperCase();
  return referenceTokens(alertReference).includes(wanted);
}

export function isKnownBankName(friend: FriendForMatch, payerName: string | null | undefined): boolean {
  if (!payerName) return false;
  const wanted = normaliseBankName(payerName);
  if (wanted.length === 0) return false;
  return friend.knownBankNames.some((known) => normaliseBankName(known) === wanted);
}

function toCandidate(request: OpenRequestForMatch): MatchCandidate {
  return { friendId: request.friendId, paymentRequestId: request.id };
}

function decide(tier: MatchReason, confidence: MatchConfidence, hits: readonly OpenRequestForMatch[]): MatchProposal | null {
  if (hits.length === 1) {
    const [hit] = hits;
    return { kind: "proposed", friendId: hit.friendId, paymentRequestId: hit.id, confidence, reason: tier };
  }
  if (hits.length > 1) {
    return { kind: "unmatched", reason: "ambiguous", tier, candidates: hits.map(toCandidate) };
  }
  return null;
}

/**
 * Ranks candidates, strongest tier first; the first tier with any hit decides:
 *
 *  (a) `reference`: the alert reference carries an open request's reference -> strong
 *  (b) `known_name_and_amount`: payer name is a known bank name of a friend and
 *      that friend has an open request for exactly the alert amount -> strong
 *  (c) `amount_only`: exactly one open request (any friend) is for the amount -> weak
 *
 * Two or more hits in the deciding tier -> `unmatched` / `ambiguous`; the
 * host picks. Requests that are not `open` must not be passed in.
 */
export function matchBankAlert(
  alert: AlertForMatch,
  openRequests: readonly OpenRequestForMatch[],
  friends: readonly FriendForMatch[],
): MatchProposal {
  const byReference = openRequests.filter((request) => referenceMatches(alert.reference, request.reference));
  const a = decide("reference", "strong", byReference);
  if (a) return a;

  const knownFriendIds = new Set(friends.filter((friend) => isKnownBankName(friend, alert.payerName)).map((f) => f.id));
  const byNameAndAmount = openRequests.filter(
    (request) => knownFriendIds.has(request.friendId) && request.amount === alert.amount,
  );
  const b = decide("known_name_and_amount", "strong", byNameAndAmount);
  if (b) return b;

  const byAmount = openRequests.filter((request) => request.amount === alert.amount);
  const c = decide("amount_only", "weak", byAmount);
  if (c) return c;

  return { kind: "unmatched", reason: "no_candidates", candidates: [] };
}

/**
 * The only case the server may confirm without the host: an exact reference
 * match, for exactly the requested amount, from a payer name the host has
 * already confirmed for that friend. The caller still checks the host's
 * `auto_confirm_bank_alerts` setting (default off).
 */
export function canAutoConfirm(
  alert: AlertForMatch,
  proposal: MatchProposal,
  request: OpenRequestForMatch,
  friend: FriendForMatch,
): boolean {
  if (proposal.kind !== "proposed" || proposal.reason !== "reference") return false;
  if (proposal.paymentRequestId !== request.id || proposal.friendId !== friend.id) return false;
  if (request.friendId !== friend.id) return false;
  if (alert.amount !== request.amount) return false;
  return isKnownBankName(friend, alert.payerName);
}
