import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { InboundEmail } from "./types";

const HeaderValue = z.union([z.string(), z.array(z.string())]);

/** Body accepted by `POST /api/inbound-email`. Extra provider fields are ignored. */
export const InboundEmailSchema = z
  .object({
    to: z.string().min(1),
    from: z.string().min(1),
    subject: z.string().default(""),
    text: z.string().default(""),
    html: z.string().optional(),
    headers: z.record(z.string(), HeaderValue).optional(),
  })
  .loose();

const ADDRESS_PATTERN = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Every email address found in a header-style value (`"Name <a@b>, c@d"`). Lower-cased. */
export function extractAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return (value.match(ADDRESS_PATTERN) ?? []).map((address) => address.toLowerCase());
}

/**
 * The per-host token: the local part of the recipient at our inbound domain.
 * `null` when no recipient is at that domain.
 */
export function extractToken(to: string, domain: string): string | null {
  const suffix = `@${domain.toLowerCase()}`;
  for (const address of extractAddresses(to)) {
    if (address.endsWith(suffix)) {
      const token = address.slice(0, -suffix.length);
      if (token.length > 0) return token;
    }
  }
  return null;
}

/** sha256 hex of from + subject + text: the idempotency key. The raw email itself is never stored. */
export function rawHash(email: InboundEmail): string {
  return createHash("sha256").update(`${email.from}\n${email.subject}\n${email.text}`, "utf8").digest("hex");
}

/** Crude HTML -> text for alerts that only arrive as HTML. Good enough for label/value lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)\s*\/?>/gi, "\n")
    .replace(/<\s*(td|th)[^>]*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text of the email: `text`, or `html` flattened when `text` is blank. */
export function bodyText(email: InboundEmail): string {
  if (email.text.trim().length > 0) return email.text;
  return email.html ? htmlToText(email.html) : "";
}

function headerValues(email: InboundEmail, name: string): string[] {
  const headers = email.headers;
  if (!headers) return [];
  const wanted = name.toLowerCase();
  const out: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === "string") out.push(value);
    else out.push(...value);
  }
  return out;
}

/** Address the message was originally sent from, or `null` when nothing is bank-like: the first `From:`... */
const FORWARDED_FROM_LINE = /^[>\s]*\**\s*(?:From|Sender|Von|De)\s*\**\s*:\s*\**\s*(.+)$/im;

/**
 * Who actually sent the alert. A Gmail/Outlook filter that *auto-forwards*
 * keeps the bank in `From` and records the hop in `X-Forwarded-For` /
 * `Resent-From`; a manually forwarded message carries the bank in a
 * "---------- Forwarded message ----------" block in the body. We check, in
 * order: the top-level `from`, `x-original-sender` / `x-original-from` /
 * `reply-to` headers, then the first `From:` line inside the body.
 *
 * Returns every candidate (lower-cased) so the caller can allowlist any of
 * them; an empty array when no address was found.
 */
export function originalSenders(email: InboundEmail): string[] {
  const candidates = new Set<string>();
  for (const address of extractAddresses(email.from)) candidates.add(address);
  for (const header of ["x-original-sender", "x-original-from", "reply-to", "resent-sender"]) {
    for (const value of headerValues(email, header)) for (const address of extractAddresses(value)) candidates.add(address);
  }
  const match = FORWARDED_FROM_LINE.exec(bodyText(email));
  if (match) for (const address of extractAddresses(match[1])) candidates.add(address);
  return [...candidates];
}

/** `allowlist` entries are domains (`dbs.com`, also matching `*.dbs.com`) or full addresses. */
export function isAllowedSender(address: string, allowlist: readonly string[]): boolean {
  const lower = address.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return false;
  const domain = lower.slice(at + 1);
  return allowlist.some((entry) => {
    const e = entry.toLowerCase();
    if (e.includes("@")) return lower === e;
    return domain === e || domain.endsWith(`.${e}`);
  });
}

/** The first allowlisted original sender, or `null` when none qualifies. */
export function verifiedBankSender(email: InboundEmail, allowlist: readonly string[]): string | null {
  return originalSenders(email).find((address) => isAllowedSender(address, allowlist)) ?? null;
}
