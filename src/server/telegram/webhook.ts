import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { createBot } from "./bot";
import { createDeps, type TelegramDeps } from "./deps";
import { telegramConfigFromEnv } from "./env";

/** Constant-time string comparison: hashes both sides so lengths never leak. */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

let cached: { deps: TelegramDeps; init: Promise<void> } | undefined;

function productionBot(): { deps: TelegramDeps; init: Promise<void> } | undefined {
  const config = telegramConfigFromEnv();
  if (!config) return undefined;
  if (!cached) {
    const deps = createDeps(config);
    cached = { deps, init: createBot(deps).init() };
  }
  return cached;
}

export interface WebhookOptions {
  /** Test seam: preconfigured deps whose bot already has handlers. */
  readonly deps?: TelegramDeps;
  readonly webhookSecret?: string;
}

/**
 * `POST /api/telegram/webhook`. 503 when the bot is not configured, 401 on a
 * missing or wrong `X-Telegram-Bot-Api-Secret-Token`, otherwise the update is
 * handled and 200 returned (also on handler errors, so Telegram does not
 * retry a poison update forever).
 */
export async function handleTelegramWebhook(request: Request, options: WebhookOptions = {}): Promise<Response> {
  const secret = options.webhookSecret ?? telegramConfigFromEnv()?.webhookSecret;
  if (!secret) return Response.json({ error: "telegram not configured" }, { status: 503 });
  if (!secretsMatch(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof update !== "object" || update === null || typeof (update as { update_id?: unknown }).update_id !== "number") {
    return Response.json({ error: "not an update" }, { status: 400 });
  }
  let deps = options.deps;
  if (!deps) {
    const production = productionBot();
    if (!production) return Response.json({ error: "telegram not configured" }, { status: 503 });
    await production.init;
    deps = production.deps;
  }
  try {
    await deps.bot.handleUpdate(update as Parameters<typeof deps.bot.handleUpdate>[0]);
  } catch (error) {
    console.error("[telegram] webhook update failed", error);
  }
  return Response.json({ ok: true });
}
