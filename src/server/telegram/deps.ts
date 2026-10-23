import "server-only";

import { Api, Bot, type Transformer } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import { createServiceClient, type DbClient } from "@/server/db/client";

import { botIdFromToken, telegramConfigFromEnv, type TelegramConfig } from "./env";

/**
 * Everything the bot code needs from the outside world. Tests build one with
 * a fake database and a transformer that answers Telegram API calls locally;
 * production uses `depsFromEnv()`.
 */
export interface TelegramDeps {
  readonly db: DbClient;
  /** grammY bot with `botInfo` preset, so no `getMe` call is made at startup. */
  readonly bot: Bot;
  /** `bot.api`; `api.config.use(transformer)` swaps the transport. */
  readonly api: Api;
  readonly botUsername: string;
  readonly now: () => Date;
}

export class TelegramNotConfiguredError extends Error {
  constructor() {
    super("Telegram is not configured: set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET.");
    this.name = "TelegramNotConfiguredError";
  }
}

export function botInfoFor(config: TelegramConfig): UserFromGetMe {
  return {
    id: botIdFromToken(config.token),
    is_bot: true,
    first_name: config.username,
    username: config.username,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

export interface CreateDepsOptions {
  readonly db?: DbClient;
  readonly transformer?: Transformer;
  readonly now?: () => Date;
}

/** Builds deps for a config; `transformer` replaces the network for tests. */
export function createDeps(config: TelegramConfig, options: CreateDepsOptions = {}): TelegramDeps {
  const bot = new Bot(config.token, { botInfo: botInfoFor(config) });
  if (options.transformer) bot.api.config.use(options.transformer);
  return {
    db: options.db ?? createServiceClient(),
    bot,
    api: bot.api,
    botUsername: config.username,
    now: options.now ?? (() => new Date()),
  };
}

/** Production deps: service-role database + real Telegram API. Throws when the env is incomplete. */
export function depsFromEnv(): TelegramDeps {
  const config = telegramConfigFromEnv();
  if (!config) throw new TelegramNotConfiguredError();
  return createDeps(config);
}
