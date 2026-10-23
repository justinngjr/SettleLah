import "server-only";

import { timingSafeEqual } from "node:crypto";

export const INBOUND_SECRET_HEADER = "x-inbound-secret";

/** Default original senders accepted as the bank. DBS and POSB alerts come from `*@dbs.com`. */
export const DEFAULT_SENDER_ALLOWLIST: readonly string[] = ["dbs.com"];

export interface InboundEmailConfig {
  /** Domain of the per-host forwarding addresses (`<token>@<domain>`). */
  readonly domain: string;
  /** Shared secret the provider sends in `X-Inbound-Secret`. */
  readonly secret: string;
  /** Domains (or full addresses) accepted as the original bank sender. */
  readonly senderAllowlist: readonly string[];
}

/** `undefined` when the webhook is not configured: the route answers 503 and the build does not need the values. */
export function inboundEmailConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): InboundEmailConfig | undefined {
  const domain = env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  const secret = env.INBOUND_EMAIL_SECRET?.trim();
  if (!domain || !secret) return undefined;
  const allowlist = (env.INBOUND_EMAIL_SENDER_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return { domain, secret, senderAllowlist: allowlist.length > 0 ? allowlist : DEFAULT_SENDER_ALLOWLIST };
}

/** Constant-time comparison of the presented secret with the configured one. */
export function verifyInboundSecret(presented: string | null | undefined, secret: string): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
