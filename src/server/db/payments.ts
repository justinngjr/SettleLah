import "server-only";

import { randomBytes } from "node:crypto";

import type { Cents } from "@/domain";
import { assertNonNegativeCents, MoneyError } from "@/domain";

import type { DbClient } from "./client";
import type { Enums, Tables, TablesInsert } from "./database.types";
import { DbError, UNIQUE_VIOLATION, unwrap, unwrapRequired } from "./errors";

export const REFERENCE_PREFIX = "SL";
export const REFERENCE_LENGTH = 6;
/** 32 symbols: digits 2-9 and uppercase letters minus I and O (no 0/1/I/O confusion). */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERENCE_PATTERN = /^SL[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/**
 * A short, human-safe payment reference such as `SLK7M2QX`. Appears on the
 * PayNow QR and in the friend's bank transfer, so it must be easy to read
 * back. 32^6 ≈ 1e9 values; collisions are handled by retrying the insert.
 */
export function generateReference(random: (bytes: number) => Uint8Array = randomBytes): string {
  const bytes = random(REFERENCE_LENGTH);
  let out = REFERENCE_PREFIX;
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    // 256 is a multiple of 32, so `& 31` is uniform.
    out += REFERENCE_ALPHABET[bytes[i] & 31];
  }
  return out;
}

export function isValidReference(reference: string): boolean {
  return REFERENCE_PATTERN.test(reference);
}

export type PaymentRequestRow = Tables<"payment_requests">;
export type PaymentClaimRow = Tables<"payment_claims">;

export interface PaymentRequest {
  readonly id: string;
  readonly hostId: string;
  readonly friendId: string;
  readonly amount: Cents;
  readonly reference: string;
  readonly status: Enums<"payment_request_status">;
  readonly note: string | null;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly cancelledAt: string | null;
}

export interface PaymentClaim {
  readonly id: string;
  readonly hostId: string;
  readonly paymentRequestId: string;
  readonly claimedAt: string;
  readonly source: Enums<"payment_claim_source">;
  readonly bankAlertId: string | null;
  /**
   * Amount actually paid. `null` on a pending `friend_button` claim means "the
   * request amount"; bank-alert claims carry the alert's amount; after
   * confirmation it is always set.
   */
  readonly amount: Cents | null;
  readonly status: Enums<"payment_claim_status">;
  readonly resolvedAt: string | null;
}

export function toPaymentRequest(row: PaymentRequestRow): PaymentRequest {
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

export function toPaymentClaim(row: PaymentClaimRow): PaymentClaim {
  return {
    id: row.id,
    hostId: row.host_id,
    paymentRequestId: row.payment_request_id,
    claimedAt: row.claimed_at,
    source: row.source,
    bankAlertId: row.bank_alert_id,
    amount: row.amount,
    status: row.status,
    resolvedAt: row.resolved_at,
  };
}

export interface NewPaymentRequest {
  readonly friendId: string;
  /** Must be > 0: ask the friend for what they owe, never for nothing. */
  readonly amount: Cents;
  readonly note?: string | null;
}

export interface CreatePaymentRequestOptions {
  readonly maxAttempts?: number;
  readonly generateReference?: () => string;
}

export const DEFAULT_REFERENCE_ATTEMPTS = 5;

function isReferenceCollision(error: DbError): boolean {
  return error.code === UNIQUE_VIOLATION && /reference/.test(`${error.message} ${error.details ?? ""}`);
}

/** Creates an `open` payment request, regenerating the reference if it collides. */
export async function createPaymentRequest(
  db: DbClient,
  hostId: string,
  input: NewPaymentRequest,
  options: CreatePaymentRequestOptions = {},
): Promise<PaymentRequest> {
  assertPositiveCents(input.amount, "payment request amount");
  const maxAttempts = options.maxAttempts ?? DEFAULT_REFERENCE_ATTEMPTS;
  const nextReference = options.generateReference ?? generateReference;

  let lastError: DbError | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const insert: TablesInsert<"payment_requests"> = {
      host_id: hostId,
      friend_id: input.friendId,
      amount: input.amount,
      reference: nextReference(),
      note: input.note ?? null,
    };
    try {
      const row = unwrapRequired(
        await db.from("payment_requests").insert(insert).select("*").single(),
        "createPaymentRequest",
      );
      return toPaymentRequest(row);
    } catch (error) {
      if (error instanceof DbError && isReferenceCollision(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw new DbError(`createPaymentRequest: no unique reference after ${maxAttempts} attempts`, {
    message: lastError?.message ?? "reference collision",
    code: lastError?.code ?? UNIQUE_VIOLATION,
    details: lastError?.details ?? "",
  });
}

export interface ListPaymentRequestsOptions {
  readonly status?: Enums<"payment_request_status">;
  readonly friendId?: string;
}

export async function listPaymentRequests(
  db: DbClient,
  hostId: string,
  options: ListPaymentRequestsOptions = {},
): Promise<PaymentRequest[]> {
  let query = db.from("payment_requests").select("*").eq("host_id", hostId).order("created_at", { ascending: false });
  if (options.status !== undefined) query = query.eq("status", options.status);
  if (options.friendId !== undefined) query = query.eq("friend_id", options.friendId);
  const rows = unwrap(await query, "listPaymentRequests") ?? [];
  return rows.map(toPaymentRequest);
}

export async function getPaymentRequestByReference(
  db: DbClient,
  hostId: string,
  reference: string,
): Promise<PaymentRequest | null> {
  const row = unwrap(
    await db.from("payment_requests").select("*").eq("host_id", hostId).eq("reference", reference).maybeSingle(),
    "getPaymentRequestByReference",
  );
  return row === null ? null : toPaymentRequest(row);
}

/** Cancels an `open` request. Paid requests cannot be cancelled: the ledger already has the payment. */
export async function cancelPaymentRequest(db: DbClient, hostId: string, requestId: string): Promise<PaymentRequest> {
  const row = unwrapRequired(
    await db
      .from("payment_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("host_id", hostId)
      .eq("id", requestId)
      .eq("status", "open")
      .select("*")
      .single(),
    "cancelPaymentRequest",
  );
  return toPaymentRequest(row);
}

export interface NewPaymentClaim {
  readonly paymentRequestId: string;
  readonly source: Enums<"payment_claim_source">;
  /** Required when `source` is `bank_alert`. */
  readonly bankAlertId?: string | null;
  /**
   * Amount paid, in cents (> 0). Omit for a friend-button claim to mean "the
   * request amount" and for a bank-alert claim to use `bank_alerts.amount`.
   * Set it when the host records a payment manually.
   */
  readonly amount?: Cents | null;
}

/**
 * Records that someone claims the request was paid (the friend pressed "I
 * paid" or a bank alert matched). A claim is a proposal: nothing hits the
 * ledger until the host confirms it.
 */
export async function createPaymentClaim(db: DbClient, hostId: string, input: NewPaymentClaim): Promise<PaymentClaim> {
  const amount = input.amount ?? null;
  if (amount !== null) assertPositiveCents(amount, "payment claim amount");
  const insert: TablesInsert<"payment_claims"> = {
    host_id: hostId,
    payment_request_id: input.paymentRequestId,
    source: input.source,
    bank_alert_id: input.bankAlertId ?? null,
    amount,
  };
  const row = unwrapRequired(await db.from("payment_claims").insert(insert).select("*").single(), "createPaymentClaim");
  return toPaymentClaim(row);
}

export async function listPendingClaims(db: DbClient, hostId: string): Promise<PaymentClaim[]> {
  const rows =
    unwrap(
      await db
        .from("payment_claims")
        .select("*")
        .eq("host_id", hostId)
        .eq("status", "pending")
        .order("claimed_at", { ascending: true }),
      "listPendingClaims",
    ) ?? [];
  return rows.map(toPaymentClaim);
}

function assertPositiveCents(amount: Cents, what: string): void {
  assertNonNegativeCents(amount, what);
  if (amount === 0) throw new MoneyError(`${what} must be greater than zero`);
}

/**
 * Confirms a pending claim: atomically (in the `confirm_payment_claim`
 * function) inserts a `payment` ledger event for the amount actually paid
 * (`amount` here > claim amount > request amount), marks the claim confirmed,
 * and marks the request paid only once confirmed payments cover it (then
 * competing pending claims are rejected). Overpayment shows up as a negative
 * balance (credit); underpayment leaves the request open. Marks a linked bank
 * alert confirmed. Returns the new ledger event id.
 */
export async function confirmPaymentClaim(db: DbClient, claimId: string, amount?: Cents): Promise<string> {
  if (amount !== undefined) assertPositiveCents(amount, "payment amount");
  const args = amount === undefined ? { p_claim_id: claimId } : { p_claim_id: claimId, p_amount: amount };
  return unwrapRequired(await db.rpc("confirm_payment_claim", args), "confirmPaymentClaim");
}

/** Rejects a pending claim; a linked proposed bank alert goes back to `unmatched`. */
export async function rejectPaymentClaim(db: DbClient, claimId: string): Promise<void> {
  unwrap(await db.rpc("reject_payment_claim", { p_claim_id: claimId }), "rejectPaymentClaim");
}
