import type { Cents } from "./money";
import { assertCents } from "./money";
import { assertDate, sgtDateString } from "./sgt";

/**
 * PayNow QR payloads (SGQR / EMVCo merchant-presented mode, dynamic). The
 * string returned by `buildPayNowPayload` is what a QR library renders; any
 * Singapore banking app scans it and pre-fills payee, amount and reference.
 *
 * Everything here is plain string assembly over integer cents. Rendering the
 * QR image is out of scope for the domain layer.
 */

export type PayNowProxyType = "mobile" | "uen";

export interface PayNowPayloadInput {
  readonly proxyType: PayNowProxyType;
  /** Mobile (`9123 4567`, `+6591234567`, `6591234567`) or UEN (8-10 alphanumeric). */
  readonly proxyValue: string;
  /** Amount in cents, 1 ..= `MAX_PAYNOW_CENTS`. */
  readonly amount: Cents;
  /** SettleLah payment reference, 1-25 alphanumeric characters. */
  readonly reference: string;
  /** Displayed by the payer's bank; ASCII-sanitised and cut to 25 characters. */
  readonly payeeName: string;
  /** The amount is always locked so friends pay exactly their share. */
  readonly editable?: false;
  /** Optional QR expiry; encoded as the Asia/Singapore calendar date. */
  readonly expiry?: Date;
}

export class PayNowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayNowError";
  }
}

/** EMVCo field 54 holds at most 13 characters; PayNow caps at $9,999,999.99. */
export const MAX_PAYNOW_CENTS: Cents = 999_999_999;
export const MAX_PAYEE_NAME_LENGTH = 25;
export const MAX_REFERENCE_LENGTH = 25;

/** EMVCo / SGQR data object IDs used in a PayNow payload, in emission order. */
export const PAYNOW_FIELD = {
  payloadFormat: "00",
  pointOfInitiation: "01",
  merchantAccount: "26",
  merchantCategory: "52",
  currency: "53",
  amount: "54",
  country: "58",
  payeeName: "59",
  city: "60",
  additionalData: "62",
  crc: "63",
} as const;

/** Sub-fields of the PayNow merchant account template (field 26). */
export const PAYNOW_ACCOUNT_FIELD = {
  scheme: "00",
  proxyType: "01",
  proxyValue: "02",
  editable: "03",
  expiry: "04",
} as const;

/** Sub-fields of the additional data template (field 62). */
export const PAYNOW_ADDITIONAL_FIELD = {
  billNumber: "01",
} as const;

export const PAYNOW_SCHEME = "SG.PAYNOW";
const PROXY_TYPE_CODE: Readonly<Record<PayNowProxyType, string>> = { mobile: "0", uen: "2" };
const CURRENCY_SGD = "702";

/**
 * Encodes one EMVCo TLV data object: 2-digit id, 2-digit length, value.
 * Values are limited to 99 characters by the 2-digit length.
 */
export function encodeTlv(id: string, value: string): string {
  if (!/^\d{2}$/.test(id)) {
    throw new PayNowError(`TLV id must be two digits, got "${id}"`);
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new PayNowError(`TLV ${id} value must be a non-empty string`);
  }
  if (value.length > 99) {
    throw new PayNowError(`TLV ${id} value is ${value.length} characters; the maximum is 99`);
  }
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export interface TlvField {
  readonly id: string;
  readonly value: string;
}

/**
 * Parses a flat sequence of TLV data objects. Nested templates (26, 62) are
 * returned as raw strings; call `parseTlv` again on their value.
 */
export function parseTlv(data: string): TlvField[] {
  if (typeof data !== "string") {
    throw new PayNowError(`expected a TLV string, got ${typeof data}`);
  }
  const fields: TlvField[] = [];
  let pos = 0;
  while (pos < data.length) {
    const id = data.slice(pos, pos + 2);
    const length = data.slice(pos + 2, pos + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(length)) {
      throw new PayNowError(`malformed TLV header at offset ${pos}`);
    }
    const valueLength = Number(length);
    const value = data.slice(pos + 4, pos + 4 + valueLength);
    if (value.length !== valueLength) {
      throw new PayNowError(`TLV ${id} at offset ${pos} declares ${valueLength} characters but the data ends early`);
    }
    fields.push({ id, value });
    pos += 4 + valueLength;
  }
  return fields;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final
 * XOR) over the ASCII bytes of `input`, as 4 uppercase hex characters.
 * Known vector: `"123456789"` -> `"29B1"`.
 */
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i);
    if (byte > 0x7f) {
      throw new PayNowError(`payload must be ASCII; found code point ${byte} at offset ${i}`);
    }
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Cents to the EMVCo amount string with exactly two decimals: `1234` -> `"12.34"`. */
export function formatAmount(cents: Cents): string {
  assertCents(cents, "amount");
  if (cents <= 0) {
    throw new PayNowError(`amount must be positive, got ${cents}`);
  }
  if (cents > MAX_PAYNOW_CENTS) {
    throw new PayNowError(`amount ${cents} exceeds the PayNow maximum of ${MAX_PAYNOW_CENTS} cents`);
  }
  const remainder = cents % 100;
  const dollars = (cents - remainder) / 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

const SG_MOBILE_PATTERN = /^(?:\+?65)?([89]\d{7})$/;

/**
 * Normalises a Singapore mobile number to the `+65XXXXXXXX` form PayNow
 * expects. Accepts `9123 4567`, `91234567`, `6591234567`, `+65 9123-4567`;
 * the local part must be 8 digits starting with 8 or 9.
 */
export function normaliseSgMobile(input: string): string {
  if (typeof input !== "string") {
    throw new PayNowError(`mobile number must be a string, got ${typeof input}`);
  }
  const compact = input.replace(/[\s\-().]/g, "");
  const match = SG_MOBILE_PATTERN.exec(compact);
  if (match === null) {
    throw new PayNowError(`"${input}" is not a Singapore mobile number (8 digits starting with 8 or 9)`);
  }
  return `+65${match[1]}`;
}

const UEN_PATTERN = /^[A-Z0-9]{8,10}$/;

/** Validates a UEN (8-10 alphanumeric characters) and returns it upper-cased. */
export function normaliseUen(input: string): string {
  if (typeof input !== "string") {
    throw new PayNowError(`UEN must be a string, got ${typeof input}`);
  }
  const uen = input.trim().toUpperCase();
  if (!UEN_PATTERN.test(uen)) {
    throw new PayNowError(`"${input}" is not a valid UEN (8-10 alphanumeric characters)`);
  }
  return uen;
}

/**
 * Reduces a display name to printable ASCII (accents stripped, other
 * non-ASCII dropped, whitespace collapsed) and cuts it to 25 characters.
 */
export function sanitisePayeeName(name: string): string {
  if (typeof name !== "string") {
    throw new PayNowError(`payee name must be a string, got ${typeof name}`);
  }
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (ascii.length === 0) {
    throw new PayNowError(`payee name "${name}" has no printable ASCII characters`);
  }
  return ascii.slice(0, MAX_PAYEE_NAME_LENGTH).trimEnd();
}

const REFERENCE_PATTERN = /^[A-Za-z0-9]{1,25}$/;

export function assertReference(reference: string): string {
  if (typeof reference !== "string" || !REFERENCE_PATTERN.test(reference)) {
    throw new PayNowError(
      `reference must be 1-${MAX_REFERENCE_LENGTH} alphanumeric characters, got ${JSON.stringify(reference)}`,
    );
  }
  return reference;
}

function proxyValueFor(proxyType: PayNowProxyType, proxyValue: string): string {
  switch (proxyType) {
    case "mobile":
      return normaliseSgMobile(proxyValue);
    case "uen":
      return normaliseUen(proxyValue);
    default:
      throw new PayNowError(`proxyType must be "mobile" or "uen", got ${String(proxyType)}`);
  }
}

/**
 * Builds the dynamic PayNow QR payload for one friend's share. Field order
 * follows the SGQR specification; the CRC in field 63 covers every
 * preceding character including the literal `6304`.
 *
 * Field 62 / 01 (bill number) carries the SettleLah payment reference. Banks
 * forward it to the payee's PayNow proxy, but whether it appears in the
 * recipient's transfer notification varies by bank, so payment matching must
 * not rely on the reference alone.
 */
export function buildPayNowPayload(input: PayNowPayloadInput): string {
  if (input.editable !== undefined && input.editable !== false) {
    throw new PayNowError("PayNow amounts from SettleLah are never editable");
  }
  const proxyValue = proxyValueFor(input.proxyType, input.proxyValue);
  const amount = formatAmount(input.amount);
  const reference = assertReference(input.reference);
  const payeeName = sanitisePayeeName(input.payeeName);
  const expiry = input.expiry === undefined ? undefined : sgtDateString(assertDate(input.expiry, "expiry"));

  const merchantAccount =
    encodeTlv(PAYNOW_ACCOUNT_FIELD.scheme, PAYNOW_SCHEME) +
    encodeTlv(PAYNOW_ACCOUNT_FIELD.proxyType, PROXY_TYPE_CODE[input.proxyType]) +
    encodeTlv(PAYNOW_ACCOUNT_FIELD.proxyValue, proxyValue) +
    encodeTlv(PAYNOW_ACCOUNT_FIELD.editable, "0") +
    (expiry === undefined ? "" : encodeTlv(PAYNOW_ACCOUNT_FIELD.expiry, expiry));

  const body =
    encodeTlv(PAYNOW_FIELD.payloadFormat, "01") +
    encodeTlv(PAYNOW_FIELD.pointOfInitiation, "12") +
    encodeTlv(PAYNOW_FIELD.merchantAccount, merchantAccount) +
    encodeTlv(PAYNOW_FIELD.merchantCategory, "0000") +
    encodeTlv(PAYNOW_FIELD.currency, CURRENCY_SGD) +
    encodeTlv(PAYNOW_FIELD.amount, amount) +
    encodeTlv(PAYNOW_FIELD.country, "SG") +
    encodeTlv(PAYNOW_FIELD.payeeName, payeeName) +
    encodeTlv(PAYNOW_FIELD.city, "Singapore") +
    encodeTlv(PAYNOW_FIELD.additionalData, encodeTlv(PAYNOW_ADDITIONAL_FIELD.billNumber, reference)) +
    `${PAYNOW_FIELD.crc}04`;

  return body + crc16CcittFalse(body);
}

/** True when `payload` ends in a CRC field that matches the rest of the payload. */
export function verifyPayNowCrc(payload: string): boolean {
  if (typeof payload !== "string" || payload.length < 8) return false;
  const body = payload.slice(0, -4);
  if (!body.endsWith(`${PAYNOW_FIELD.crc}04`)) return false;
  try {
    return crc16CcittFalse(body) === payload.slice(-4).toUpperCase();
  } catch {
    return false;
  }
}
