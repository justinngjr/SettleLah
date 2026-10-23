import "server-only";

import { fromDollars, MoneyError } from "@/domain";

import { bodyText } from "../email";
import { ParseError, type BankAlertParser, type InboundEmail, type ParsedBankAlert } from "../types";

/**
 * DBS / POSB digibank "incoming transfer" alert emails (PayNow and FAST).
 *
 * The exact current wording is UNVERIFIED (see the PR / README for the phrases
 * this depends on). The parser is deliberately tolerant:
 *   * amount:   `SGD 12.34`, `S$12.34`, `SGD1,234.50`, `$12.34`; the first one
 *               after "received"/"transfer of"/"credited"/"amount" wins, else the first in the text
 *   * payer:    a labelled line (`From:`, `Payer's Name:`, `Sender Name:`, `Remitter:`...)
 *               or `... from <NAME IN CAPS>` in the sentence
 *   * reference: `Reference`, `Payer's Reference`, `Other info`, `Transaction Ref`,
 *               `Remarks`, `Comments`, `Message` lines; `-`/`NIL`/`NA` -> null
 *   * receivedAt: `12 Jan 2025 10:23`, `12 Jan 2025, 10:23 PM (SGT)`, `12/01/2025 10:23`,
 *               `2025-01-12 10:23:45`; falls back to the `Date` header, else the ingest time
 */

const BANK_HINT = /\b(DBS|POSB)\b/i;
const TRANSFER_HINT = /\b(PayNow|FAST|incoming|received|credited|funds?\s+transfer)\b/i;

const AMOUNT = String.raw`(?:SGD|S\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const AMOUNT_ANY = new RegExp(AMOUNT, "i");
const AMOUNT_AFTER_VERB = new RegExp(
  String.raw`(?:received|transfer\s+of|credited\s+(?:with|for)?|amount(?:\s+received)?\s*[:\-]?|sum\s+of)\s*(?:an?\s+)?(?:incoming\s+)?(?:PayNow|FAST)?\s*(?:transfer\s+of\s+)?` +
    AMOUNT,
  "i",
);

const PAYER_LABEL = new RegExp(
  String.raw`^[>\s*]*(?:payer(?:'s)?(?:\s+name)?|sender(?:'s)?(?:\s+name)?|remitter(?:'s)?(?:\s+name)?|received\s+from|from(?:\s+name)?|paid\s+by|transferred\s+by)\s*\**\s*:\s*\**\s*(.+?)\s*\**\s*$`,
  "im",
);
const PAYER_INLINE = /\bfrom\s+([A-Z][A-Z0-9 .,'/&()-]{1,80}?)(?=\s*(?:[.;,\n]|\(|\bon\b|\bto\b|\bvia\b|\bwith\b|$))/;

const REFERENCE_WORDS = String.raw`(?:payer(?:'s)?\s+reference|reference(?:\s+(?:no|number))?|other\s+info(?:rmation)?|transaction\s+ref(?:erence)?(?:\s+(?:no|number))?|txn\s+ref(?:erence)?|remarks?|comments?|message|description|bill\s+reference)`;
const REFERENCE_LABEL = new RegExp(
  String.raw`^[>\s*]*${REFERENCE_WORDS}(?:\s*\/\s*${REFERENCE_WORDS})?\s*\**\s*:\s*\**\s*(.*?)\s*\**\s*$`,
  "im",
);
const EMPTY_REFERENCE = /^(?:-+|n\/?a|nil|none|not\s+available)?$/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const DATE_WORDS = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i;
const DATE_SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i;
const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function sgt(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date | null {
  const date = new Date(Date.UTC(year, month, day, hour, minute, second) - SGT_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hour24(hour: string | undefined, meridiem: string | undefined): number {
  let h = hour === undefined ? 0 : Number(hour);
  if (meridiem?.toLowerCase() === "pm" && h < 12) h += 12;
  if (meridiem?.toLowerCase() === "am" && h === 12) h = 0;
  return h;
}

/** First recognisable date in `text`, read as Singapore wall-clock time. */
export function parseSgtDate(text: string): Date | null {
  const words = DATE_WORDS.exec(text);
  if (words) {
    const month = MONTHS[words[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return sgt(Number(words[3]), month, Number(words[1]), hour24(words[4], words[7]), Number(words[5] ?? 0), Number(words[6] ?? 0));
    }
  }
  const slash = DATE_SLASH.exec(text);
  if (slash) {
    return sgt(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]), hour24(slash[4], slash[7]), Number(slash[5] ?? 0), Number(slash[6] ?? 0));
  }
  const iso = DATE_ISO.exec(text);
  if (iso) {
    return sgt(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0));
  }
  return null;
}

function headerDate(email: InboundEmail): Date | null {
  const raw = email.headers?.date ?? email.headers?.Date;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Strips the forwarded-message preamble so `From:` in it is not mistaken for the payer. */
function alertBody(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /forwarded message|begin forwarded message|original message/i.test(line));
  if (start < 0) return text;
  // Skip the preamble header block (From/Date/Subject/To lines) that follows the marker.
  let i = start + 1;
  while (i < lines.length && /^[>\s*]*(from|date|sent|subject|to|cc)\s*\**\s*:/i.test(lines[i])) i++;
  return lines.slice(i).join("\n");
}

function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").replace(/^[\s"'*]+|[\s"'*.]+$/g, "").trim();
  if (name.length < 2 || /@/.test(name)) return null;
  return name;
}

export function parseAmountCents(text: string): number | null {
  const match = AMOUNT_AFTER_VERB.exec(text) ?? AMOUNT_ANY.exec(text);
  if (!match) return null;
  try {
    const cents = fromDollars(match[1]);
    return cents > 0 ? cents : null;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

export function parsePayerName(text: string): string | null {
  const labelled = PAYER_LABEL.exec(text);
  if (labelled) {
    const name = cleanName(labelled[1]);
    if (name) return name;
  }
  const inline = PAYER_INLINE.exec(text);
  return inline ? cleanName(inline[1]) : null;
}

export function parseReference(text: string): string | null {
  const match = REFERENCE_LABEL.exec(text);
  if (!match) return null;
  const value = match[1].replace(/\s+/g, " ").trim();
  return EMPTY_REFERENCE.test(value) ? null : value;
}

export const dbsParser: BankAlertParser = {
  bank: "DBS",
  canParse(email) {
    const haystack = `${email.subject}\n${bodyText(email)}`;
    return BANK_HINT.test(`${email.from}\n${haystack}`) && TRANSFER_HINT.test(haystack);
  },
  parse(email): ParsedBankAlert {
    const text = alertBody(`${email.subject}\n${bodyText(email)}`);
    const amount = parseAmountCents(text);
    if (amount === null) throw new ParseError(this.bank, "no SGD amount found");
    const payerName = parsePayerName(text);
    const reference = parseReference(text);
    const receivedAt = parseSgtDate(text) ?? headerDate(email) ?? new Date();
    return { amount, payerName, reference, receivedAt };
  },
};
