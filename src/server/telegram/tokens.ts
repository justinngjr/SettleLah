import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { MS_PER_DAY, MS_PER_HOUR } from "@/domain";
import type { DbClient } from "@/server/db/client";
import type { Enums, Tables } from "@/server/db/database.types";
import { unwrap, unwrapRequired } from "@/server/db/errors";

export type LinkTokenKind = Enums<"telegram_link_kind">;
export type LinkTokenRow = Tables<"telegram_link_tokens">;

export interface LinkToken {
  readonly id: string;
  readonly hostId: string;
  readonly kind: LinkTokenKind;
  readonly receiptId: string | null;
  readonly singleUse: boolean;
  readonly expiresAt: string;
  readonly usedAt: string | null;
}

/** Deep-link payload prefixes (`/start host_…`, `?startgroup=grp_…`, `/start fr_…`). */
export const START_PREFIX: Readonly<Record<LinkTokenKind, string>> = { host: "host_", group: "grp_", friend: "fr_" };

/** Host and group links are single use and short-lived; the friend link on a split message is shared by the whole group. */
export const TOKEN_TTL_MS: Readonly<Record<LinkTokenKind, number>> = {
  host: 24 * MS_PER_HOUR,
  group: 24 * MS_PER_HOUR,
  friend: 30 * MS_PER_DAY,
};

/** 32 random bytes as base64url (43 chars): fits Telegram's 64-char start payload with the prefix. */
export function generateToken(random: (bytes: number) => Uint8Array = randomBytes): string {
  return Buffer.from(random(32)).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function toLinkToken(row: LinkTokenRow): LinkToken {
  return {
    id: row.id,
    hostId: row.host_id,
    kind: row.kind,
    receiptId: row.receipt_id,
    singleUse: row.single_use,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

export interface CreateTokenOptions {
  readonly receiptId?: string | null;
  readonly now?: Date;
  readonly random?: (bytes: number) => Uint8Array;
}

/** Stores sha256(token) and returns the plaintext once; it only ever lives in the URL. */
export async function createLinkToken(
  db: DbClient,
  hostId: string,
  kind: LinkTokenKind,
  options: CreateTokenOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const token = generateToken(options.random);
  unwrapRequired(
    await db
      .from("telegram_link_tokens")
      .insert({
        host_id: hostId,
        kind,
        token_hash: hashToken(token),
        receipt_id: kind === "friend" ? (options.receiptId ?? null) : null,
        single_use: kind !== "friend",
        expires_at: new Date(now.getTime() + TOKEN_TTL_MS[kind]).toISOString(),
      })
      .select("id")
      .single(),
    "createLinkToken",
  );
  return token;
}

export function hostLinkUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${START_PREFIX.host}${token}`;
}

export function groupLinkUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?startgroup=${START_PREFIX.group}${token}`;
}

export function friendLinkUrl(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${START_PREFIX.friend}${token}`;
}

export interface StartPayload {
  readonly kind: LinkTokenKind;
  readonly token: string;
}

/** Splits a `/start` payload into its kind and token; `null` for anything we did not issue. */
export function parseStartPayload(payload: string | undefined): StartPayload | null {
  if (!payload) return null;
  for (const kind of Object.keys(START_PREFIX) as LinkTokenKind[]) {
    const prefix = START_PREFIX[kind];
    if (payload.startsWith(prefix)) {
      const token = payload.slice(prefix.length);
      return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? { kind, token } : null;
    }
  }
  return null;
}

/**
 * Looks a token up by hash and checks kind and expiry. A single-use token is
 * consumed with a conditional update (`used_at is null`), so two concurrent
 * consumers cannot both succeed. Returns `null` when the token is unknown,
 * of the wrong kind, expired or already used.
 */
export async function consumeLinkToken(
  db: DbClient,
  kind: LinkTokenKind,
  token: string,
  now: Date = new Date(),
): Promise<LinkToken | null> {
  const hash = hashToken(token);
  const row = unwrap<LinkTokenRow>(
    await db.from("telegram_link_tokens").select("*").eq("token_hash", hash).eq("kind", kind).maybeSingle(),
    "consumeLinkToken",
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null;
  if (!row.single_use) return toLinkToken(row);
  if (row.used_at !== null) return null;
  const consumed = unwrap<LinkTokenRow>(
    await db
      .from("telegram_link_tokens")
      .update({ used_at: now.toISOString() })
      .eq("id", row.id)
      .is("used_at", null)
      .select("*")
      .maybeSingle(),
    "consumeLinkToken",
  );
  return consumed ? toLinkToken(consumed) : null;
}
