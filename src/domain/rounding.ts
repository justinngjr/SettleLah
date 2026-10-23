import type { Cents } from "./money";
import { assertNonNegativeCents } from "./money";
import type { Rational } from "./rational";
import { rationalCompare, rationalIsZero, rationalSign } from "./rational";

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

/**
 * Policy for a host who fronted the bill and must never absorb rounding:
 * leftover cents go to the friends, chosen by the default largest-remainder
 * rule over the non-host candidates (the host always gets 0 extra cents).
 *
 * Falls back to `allocateRemainder` over everyone when the host is not a
 * candidate, or when no friend has a nonzero exact share (host treats, all
 * friends excluded, ...). Friends whose exact share is 0 never receive cents.
 *
 * When the leftovers come from flooring exact shares, `leftoverCents` is the
 * sum of the fractions, each `< 1`, so it is at most (number of candidates
 * with a nonzero fraction) - 1, i.e. never more than the number of eligible
 * friends: each friend gets at most one extra cent. Larger leftovers (only
 * possible for direct callers) are spread round-robin, equal whole cents to
 * every eligible friend, then the rest by largest remainder, so the sum stays
 * exact.
 */
export function hostNeverAbsorbs(hostId: string): RemainderPolicy {
  return (leftoverCents, candidates) => {
    assertNonNegativeCents(leftoverCents, "leftoverCents");
    const hostIndex = candidates.findIndex((candidate) => candidate.participantId === hostId);
    const friends = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) => index !== hostIndex && hasNonZeroShare(candidate));
    if (hostIndex === -1 || friends.length === 0) {
      return allocateRemainder(leftoverCents, candidates);
    }

    const rest = leftoverCents % friends.length;
    const eachFriend = (leftoverCents - rest) / friends.length;
    const friendExtras = allocateRemainder(
      rest,
      friends.map(({ candidate }) => candidate),
    );
    const extras = new Array<Cents>(candidates.length).fill(0);
    friends.forEach(({ index }, k) => {
      extras[index] = eachFriend + friendExtras[k];
    });
    return extras;
  };
}

function hasNonZeroShare(candidate: RemainderCandidate): boolean {
  return candidate.floorCents !== 0 || !rationalIsZero(candidate.fraction);
}
