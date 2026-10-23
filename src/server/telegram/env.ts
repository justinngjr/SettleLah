import "server-only";

export interface TelegramConfig {
  readonly token: string;
  readonly username: string;
  readonly webhookSecret: string;
}

/**
 * All three Telegram variables must be set or the bot is "not configured":
 * the webhook route answers 503 and server functions throw. The build never
 * needs them.
 */
export function telegramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramConfig | undefined {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token || !username || !webhookSecret) return undefined;
  return { token, username, webhookSecret };
}

export function cronSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const secret = env.CRON_SECRET?.trim();
  return secret ? secret : undefined;
}

/** A bot token is `<bot id>:<secret>`; knowing the id avoids a `getMe` round trip at startup. */
export function botIdFromToken(token: string): number {
  const id = Number(token.split(":")[0]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("TELEGRAM_BOT_TOKEN does not look like a bot token");
  return id;
}
