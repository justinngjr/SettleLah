import type { Cents } from "./money";
import { assertNonNegativeCents } from "./money";
import type { Rational } from "./rational";
import { rationalCompare, rationalSign } from "./rational";

/**
 * One participant's exact share before leftover cents are handed out.
 */
export interface RemainderCandidate {
  readonly participantId: string;
  /** The exact share rounded down to whole cents. */
  readonly floorCents: Cents;
  /** The part of the exact share that was dropped by flooring, in [0, 1). */
  readonly fraction: Rational;
}

/**
 * Policy for distributing the cents that flooring every exact share leaves
 * unallocated. Returns one non-negative integer per candidate (same order as
 * the input) whose sum is exactly `leftoverCents`.
 *
 * This is deliberately the *only* place that decides who absorbs rounding.
 * The host may replace the policy later (e.g. "host absorbs", "random") by
 * changing `allocateRemainder` or by passing a different `RemainderPolicy`
 * to `splitReceipt`; the sum invariant is re-checked by the caller.
 */
export type RemainderPolicy = (
  leftoverCents: Cents,
  candidates: readonly RemainderCandidate[],
) => Cents[];

/**
 * Default policy: largest-remainder method. Each leftover cent goes to the
 * candidate with the largest dropped fraction; ties are broken by input
 * (participant) order. Deterministic and never gives any candidate more than
 * one extra cent as long as `leftoverCents < candidates.length`, which always
 * holds when the leftovers come from flooring exact shares.
 */
export const allocateRemainder: RemainderPolicy = (leftoverCents, candidates) => {
  assertNonNegativeCents(leftoverCents, "leftoverCents");
  if (leftoverCents > candidates.length) {
    throw new RangeError(
      `cannot allocate ${leftoverCents} leftover cents across ${candidates.length} candidates`,
    );
  }
  for (const candidate of candidates) {
    const sign = rationalSign(candidate.fraction);
    if (sign < 0 || rationalCompare(candidate.fraction, { num: BigInt(1), den: BigInt(1) }) >= 0) {
      throw new RangeError(`fraction for ${candidate.participantId} must be in [0, 1)`);
    }
  }

  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => rationalCompare(b.candidate.fraction, a.candidate.fraction) || a.index - b.index);

  const extras = new Array<Cents>(candidates.length).fill(0);
  for (let i = 0; i < leftoverCents; i++) {
    extras[order[i].index] = 1;
  }
  return extras;
};
