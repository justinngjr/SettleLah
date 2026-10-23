import type { Cents } from "./money";
import { assertNonNegativeCents, MoneyError } from "./money";

/** Basis points: 1 bp = 0.01%, so 10 000 bp = 100%. */
export type BasisPoints = number;

export const BPS_PER_WHOLE = 10_000;

/** Singapore service charge, 10%. */
export const SG_SERVICE_CHARGE_BPS: BasisPoints = 1_000;
/** Singapore GST, 9% (from 1 Jan 2024). */
export const SG_GST_BPS: BasisPoints = 900;

/**
 * How a receipt's charges are computed on top of its line items. Rates are
 * basis points so they stay integers.
 *
 * - No service charge: `serviceChargeBps: 0`.
 * - Prices already GST-inclusive (or no GST): `gstBps: 0`.
 */
export interface ChargePolicy {
  readonly serviceChargeBps: BasisPoints;
  readonly gstBps: BasisPoints;
}

/** 10% service charge then 9% GST on (subtotal + service charge). */
export const SG_STANDARD_CHARGES: ChargePolicy = {
  serviceChargeBps: SG_SERVICE_CHARGE_BPS,
  gstBps: SG_GST_BPS,
};

/** 9% GST only, e.g. a cafe or takeaway with no service charge. */
export const SG_GST_ONLY: ChargePolicy = { serviceChargeBps: 0, gstBps: SG_GST_BPS };

/** Prices are what you pay, e.g. hawker centre or GST-inclusive menu. */
export const NO_CHARGES: ChargePolicy = { serviceChargeBps: 0, gstBps: 0 };

/** The printed lines of a receipt. `total = subtotal + serviceCharge + gst`. */
export interface ReceiptTotals {
  readonly subtotal: Cents;
  readonly serviceCharge: Cents;
  readonly gst: Cents;
  readonly total: Cents;
}

export function assertBasisPoints(value: unknown, label = "rate"): BasisPoints {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative integer number of basis points`);
  }
  return value;
}

export function assertChargePolicy(policy: ChargePolicy): ChargePolicy {
  assertBasisPoints(policy.serviceChargeBps, "serviceChargeBps");
  assertBasisPoints(policy.gstBps, "gstBps");
  return policy;
}

/**
 * `amount × bps / 10 000`, rounded half-up to the nearest cent, using only
 * integer arithmetic. This is how a printed receipt rounds each charge line.
 */
export function applyRateHalfUp(amount: Cents, bps: BasisPoints): Cents {
  assertNonNegativeCents(amount, "amount");
  assertBasisPoints(bps, "bps");
  const scaled = amount * bps;
  if (!Number.isSafeInteger(scaled)) {
    throw new MoneyError(`${amount} × ${bps} bps overflows the safe integer range`);
  }
  const shifted = scaled + BPS_PER_WHOLE / 2;
  return (shifted - (shifted % BPS_PER_WHOLE)) / BPS_PER_WHOLE;
}

/**
 * Computes the receipt lines for a pre-charge subtotal: service charge is
 * applied to the subtotal, then GST is applied to (subtotal + service charge),
 * each line rounded half-up to the cent as a printed receipt does.
 */
export function computeCharges(subtotal: Cents, policy: ChargePolicy): ReceiptTotals {
  assertNonNegativeCents(subtotal, "subtotal");
  assertChargePolicy(policy);
  const serviceCharge = applyRateHalfUp(subtotal, policy.serviceChargeBps);
  const gst = applyRateHalfUp(subtotal + serviceCharge, policy.gstBps);
  return { subtotal, serviceCharge, gst, total: subtotal + serviceCharge + gst };
}
