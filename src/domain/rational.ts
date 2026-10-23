/**
 * Minimal exact rational arithmetic on top of `bigint`, used for the
 * intermediate (unrounded) values in bill splitting. Never converted to a
 * float; results re-enter the integer-cents world only through `floorDiv`
 * and `allocateRemainder`.
 *
 * `BigInt(...)` calls are used instead of `0n` literals because the project
 * compiles with `target: ES2017`, which disallows bigint literals.
 */
export interface Rational {
  /** Numerator; carries the sign. */
  readonly num: bigint;
  /** Denominator; always > 0. */
  readonly den: bigint;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);

function gcd(a: bigint, b: bigint): bigint {
  let x = a < ZERO ? -a : a;
  let y = b < ZERO ? -b : b;
  while (y !== ZERO) {
    [x, y] = [y, x % y];
  }
  return x;
}

function make(num: bigint, den: bigint): Rational {
  if (den === ZERO) {
    throw new RangeError("rational denominator must not be zero");
  }
  if (den < ZERO) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g === ZERO || g === ONE ? { num, den } : { num: num / g, den: den / g };
}

export const RATIONAL_ZERO: Rational = { num: ZERO, den: ONE };

export function rationalFromInt(value: number | bigint): Rational {
  return { num: BigInt(value), den: ONE };
}

/** `numerator / denominator` as an exact rational. */
export function ratio(numerator: number | bigint, denominator: number | bigint): Rational {
  return make(BigInt(numerator), BigInt(denominator));
}

export function rationalAdd(a: Rational, b: Rational): Rational {
  if (a.den === b.den) {
    return make(a.num + b.num, a.den);
  }
  return make(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function rationalSub(a: Rational, b: Rational): Rational {
  return rationalAdd(a, { num: -b.num, den: b.den });
}

export function rationalMul(a: Rational, b: Rational): Rational {
  return make(a.num * b.num, a.den * b.den);
}

export function rationalDiv(a: Rational, b: Rational): Rational {
  return make(a.num * b.den, a.den * b.num);
}

/** Negative, zero or positive sign of `a` as -1 | 0 | 1. */
export function rationalSign(a: Rational): -1 | 0 | 1 {
  return a.num < ZERO ? -1 : a.num > ZERO ? 1 : 0;
}

export function rationalIsZero(a: Rational): boolean {
  return a.num === ZERO;
}

/** Total order: negative if a < b, zero if equal, positive if a > b. */
export function rationalCompare(a: Rational, b: Rational): -1 | 0 | 1 {
  return rationalSign(rationalSub(a, b));
}

/** Largest integer <= a (floor, also for negatives). */
export function rationalFloor(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num < ZERO && q * a.den !== a.num ? q - ONE : q;
}

/** `a` minus its floor, in [0, 1). */
export function rationalFraction(a: Rational): Rational {
  return rationalSub(a, rationalFromInt(rationalFloor(a)));
}

/** Converts a bigint back to a safe-integer `number`, throwing on overflow. */
export function bigintToSafeNumber(value: bigint): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== value) {
    throw new RangeError(`${value.toString()} is outside the safe integer range`);
  }
  return asNumber;
}
