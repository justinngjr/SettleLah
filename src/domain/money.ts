/**
 * Money is always an integer number of cents. There is no floating-point
 * arithmetic on money anywhere in the domain layer.
 */
export type Cents = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Asserts `value` is a safe integer (any sign) and returns it as `Cents`. */
export function assertCents(value: unknown, label = "amount"): Cents {
  if (!isCents(value)) {
    throw new MoneyError(`${label} must be an integer number of cents, got ${String(value)}`);
  }
  return value;
}

/** Asserts `value` is a safe integer >= 0 and returns it as `Cents`. */
export function assertNonNegativeCents(value: unknown, label = "amount"): Cents {
  const cents = assertCents(value, label);
  if (cents < 0) {
    throw new MoneyError(`${label} must not be negative, got ${cents}`);
  }
  return cents;
}

const DOLLARS_PATTERN = /^(-)?\$?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses a dollar string such as `"12.34"`, `"$12.34"`, `"1,234.5"` or `"-3"`
 * into integer cents. Rejects more than two decimal places, exponents,
 * whitespace inside the number and anything that is not a plain decimal.
 */
export function fromDollars(input: string): Cents {
  if (typeof input !== "string") {
    throw new MoneyError(`expected a dollar string, got ${typeof input}`);
  }
  const match = DOLLARS_PATTERN.exec(input.trim());
  if (match === null) {
    throw new MoneyError(`"${input}" is not a valid dollar amount (max 2 decimal places)`);
  }
  const [, sign, whole, fraction = ""] = match;
  const dollars = Number(whole.replace(/,/g, ""));
  const cents = Number(fraction.padEnd(2, "0"));
  const magnitude = dollars * 100 + cents;
  if (!Number.isSafeInteger(magnitude)) {
    throw new MoneyError(`"${input}" is too large to represent exactly`);
  }
  return sign === "-" ? -magnitude : magnitude;
}

/** Formats integer cents as Singapore dollars, e.g. `1234` -> `"$12.34"`, `-5` -> `"-$0.05"`. */
export function formatSGD(cents: Cents): string {
  assertCents(cents, "cents");
  const magnitude = Math.abs(cents);
  const remainder = magnitude % 100;
  const dollars = (magnitude - remainder) / 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `$${grouped}.${String(remainder).padStart(2, "0")}`;
  return cents < 0 ? `-${body}` : body;
}
