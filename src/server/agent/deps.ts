import "server-only";

import type { DbClient } from "@/server/db";
import { createOpenAiCaller, llmConfigFromEnv, type LlmConfig } from "@/server/interpret/client";
import { createDeps, telegramConfigFromEnv, TelegramNotConfiguredError, type TelegramDeps } from "@/server/telegram";

import type { AgentDeps } from "./loop";
import type { ToolContext } from "./tools";

/** Model access for the agent, or `undefined` when the LLM env is not set (the routes answer 503). */
export function agentDepsFromEnv(config: LlmConfig | undefined = llmConfigFromEnv()): AgentDeps | undefined {
  if (!config) return undefined;
  return { llm: createOpenAiCaller(config), model: config.model, ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}) };
}

/**
 * The context tools run in for one host. Telegram deps use the host's RLS
 * client (not the service role), so a tool can only message about this
 * host's own requests and receipts.
 */
export function buildToolContext(input: {
  readonly db: DbClient;
  readonly hostId: string;
  readonly now?: Date;
  readonly agent?: AgentDeps;
  readonly attachedImage?: string;
  readonly telegram?: () => TelegramDeps;
}): ToolContext {
  const now = input.now ?? new Date();
  const telegram =
    input.telegram ??
    (() => {
      const config = telegramConfigFromEnv();
      if (!config) throw new TelegramNotConfiguredError();
      return createDeps(config, { db: input.db, now: () => new Date() });
    });
  return {
    db: input.db,
    hostId: input.hostId,
    now,
    telegram,
    ...(input.agent ? { interpret: { llm: input.agent.llm, model: input.agent.model, ...(input.agent.fallbackModel ? { fallbackModel: input.agent.fallbackModel } : {}) } } : {}),
    ...(input.attachedImage ? { attachedImage: input.attachedImage } : {}),
  };
}
