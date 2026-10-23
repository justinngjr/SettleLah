import "server-only";

import OpenAI, { APIError } from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type LlmUserContent = { type: "text"; text: string } | { type: "image"; dataUrl: string };

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "assistant"; content: string }
  | { role: "user"; content: LlmUserContent[] };

/**
 * How we ask for structured output, in order of preference. `interpretReceipt`
 * steps down this list when the provider rejects a format with HTTP 400.
 */
export type LlmResponseFormat =
  | { type: "json_schema"; name: string; schema: Record<string, unknown> }
  | { type: "json_object" }
  | { type: "text" };

export interface LlmRequest {
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly responseFormat: LlmResponseFormat;
}

export interface LlmCompletion {
  /** The assistant message text (expected to be JSON). */
  readonly text: string;
}

/** The only thing `interpretReceipt` needs from a model. Tests inject fakes. */
export interface LlmCaller {
  /** Identifies the provider, e.g. its base URL; used to remember which response formats each model accepts. */
  readonly baseURL?: string;
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/** Thrown by `LlmCaller` implementations when the provider errors. `status` is the HTTP status if known. */
export class LlmRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmRequestError";
    this.status = status;
  }

  /** True for a 400 that most likely means "unsupported response_format". */
  get isBadRequest(): boolean {
    return this.status === 400;
  }

  /**
   * True when the failure is on the provider's side (network/timeout, 404
   * model not found, 429, 5xx), so trying another model makes sense. False
   * for errors caused by our own request (400, 401, 403, 413, 422, ...).
   */
  get isProviderFailure(): boolean {
    if (this.status === undefined) return true;
    return this.status === 404 || this.status === 429 || this.status >= 500;
  }
}

export interface LlmConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModel?: string;
}

/**
 * Reads `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (all required) and
 * `LLM_FALLBACK_MODEL` (optional); `undefined` if a required one is unset.
 */
export function llmConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): LlmConfig | undefined {
  const baseURL = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  const fallbackModel = env.LLM_FALLBACK_MODEL?.trim();
  if (!baseURL || !apiKey || !model) return undefined;
  return fallbackModel && fallbackModel !== model ? { baseURL, apiKey, model, fallbackModel } : { baseURL, apiKey, model };
}

function toOpenAiMessages(messages: readonly LlmMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role === "user") {
      const content = message.content.map((part): ChatCompletionContentPart => {
        if (part.type === "image") {
          return { type: "image_url", image_url: { url: part.dataUrl } };
        }
        return { type: "text", text: part.text };
      });
      return { role: "user", content };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAiResponseFormat(format: LlmResponseFormat) {
  switch (format.type) {
    case "json_schema":
      return { type: "json_schema" as const, json_schema: { name: format.name, schema: format.schema } };
    case "json_object":
      return { type: "json_object" as const };
    case "text":
      return undefined;
  }
}

/**
 * `LlmCaller` backed by the OpenAI SDK pointed at an OpenAI-compatible
 * provider. Non-streaming chat completions; temperature 0 for determinism.
 */
export function createOpenAiCaller(
  config: Pick<LlmConfig, "baseURL" | "apiKey">,
  options: { timeoutMs?: number } = {},
): LlmCaller {
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: 1,
  });

  return {
    baseURL: config.baseURL,
    async complete(request) {
      try {
        const completion = await client.chat.completions.create({
          model: request.model,
          messages: toOpenAiMessages(request.messages),
          response_format: toOpenAiResponseFormat(request.responseFormat),
          temperature: 0,
        });
        const text = completion.choices[0]?.message.content;
        if (typeof text !== "string" || text.length === 0) {
          throw new LlmRequestError("LLM returned an empty response");
        }
        return { text };
      } catch (error) {
        if (error instanceof LlmRequestError) throw error;
        if (error instanceof APIError) {
          throw new LlmRequestError(`LLM request failed: ${error.message}`, error.status, { cause: error });
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new LlmRequestError(`LLM request failed: ${message}`, undefined, { cause: error });
      }
    },
  };
}
