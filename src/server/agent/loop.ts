import "server-only";

import { z } from "zod";

import { LlmRequestError, type LlmCaller, type LlmMessage, type LlmResponseFormat, type LlmToolCall } from "@/server/interpret/client";
import { extractJson, stripReasoning } from "@/server/interpret/interpret";

import { buildAgentSystemPrompt, wrapData } from "./prompt";
import { appendMessage, createAction, listMessages, touchConversation, type AgentAction, type AgentMessage } from "./store";
import { previewHash, ToolError, ToolRegistry, type ToolContext } from "./tools";

export const MAX_STEPS = 8;
export const TURN_BUDGET_MS = 60_000;

export type ToolMode = "native" | "json";

export interface AgentDeps {
  readonly llm: LlmCaller;
  readonly model: string;
  readonly fallbackModel?: string;
  readonly registry?: ToolRegistry;
  readonly hostName?: string | null;
  readonly maxSteps?: number;
  readonly budgetMs?: number;
}

export type AgentEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly name: string; readonly ok: boolean }
  | { readonly type: "action"; readonly action: AgentAction }
  | { readonly type: "done"; readonly reason: "reply" | "max_steps" | "timeout" };

export type AgentErrorCode = "llm_request_failed" | "invalid_output" | "llm_unavailable";

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number | undefined;

  constructor(code: AgentErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
  }
}

/** The tool-calling mode each (provider, model) is known to accept. Module memory, like the response-format cache. */
const toolModes = new Map<string, ToolMode>();
const modeKey = (llm: LlmCaller, model: string) => `${llm.baseURL ?? ""}\u0000${model}`;

export function knownToolMode(llm: LlmCaller, model: string): ToolMode | undefined {
  return toolModes.get(modeKey(llm, model));
}

export function resetToolModeCache(): void {
  toolModes.clear();
}

const JsonProtocolSchema = z.object({
  say: z.string().default(""),
  tool_calls: z.array(z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) })).default([]),
});

interface ModelReply {
  readonly text: string;
  readonly toolCalls: readonly LlmToolCall[];
  readonly mode: ToolMode;
}

/** Stored transcript -> provider messages. Tool results are always wrapped as data. */
export function toLlmMessages(history: readonly AgentMessage[], mode: ToolMode, attachedImageNote: boolean): LlmMessage[] {
  const out: LlmMessage[] = [];
  const lastUserIndex = history.map((m) => m.role).lastIndexOf("user");
  history.forEach((message, index) => {
    switch (message.role) {
      case "user": {
        const note = attachedImageNote && index === lastUserIndex ? "\n\n[The host attached a photo of a receipt to this message. Use interpret_receipt with useAttachedImage: true to read it.]" : "";
        if (message.toolResult !== null) {
          out.push({ role: "user", content: [{ type: "text", text: wrapData("action update from the app", message.content) }] });
        } else {
          out.push({ role: "user", content: [{ type: "text", text: message.content + note }] });
        }
        return;
      }
      case "assistant": {
        if (mode === "native") {
          out.push({ role: "assistant", content: message.content, ...(message.toolCalls && message.toolCalls.length > 0 ? { toolCalls: message.toolCalls } : {}) });
        } else {
          const calls = (message.toolCalls ?? []).map((call) => ({ name: call.name, args: safeParseArgs(call.arguments) }));
          out.push({ role: "assistant", content: JSON.stringify({ say: message.content, tool_calls: calls }) });
        }
        return;
      }
      case "tool": {
        const body = wrapData(`tool result: ${toolNameFor(history, message.toolCallId)}`, JSON.stringify(message.toolResult));
        if (mode === "native") {
          out.push({ role: "tool", toolCallId: message.toolCallId ?? "", content: body });
        } else {
          const previous = out[out.length - 1];
          if (previous && previous.role === "user") {
            previous.content.push({ type: "text", text: body });
          } else {
            out.push({ role: "user", content: [{ type: "text", text: body }] });
          }
        }
        return;
      }
    }
  });
  return out;
}

function toolNameFor(history: readonly AgentMessage[], toolCallId: string | null): string {
  for (const message of history) {
    const call = message.toolCalls?.find((c) => c.id === toolCallId);
    if (call) return call.name;
  }
  return "unknown";
}

function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolErrorResult(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

function toJson(value: unknown): NonNullable<import("@/server/db").Json> {
  return JSON.parse(JSON.stringify(value ?? null)) ?? {};
}

/**
 * One call to the model in the mode the provider is known to accept: native
 * `tools` first; if the provider answers 400 to `tools`, the JSON protocol
 * (`json_object`, then plain text) from then on for this (provider, model).
 * One retry when the JSON protocol output does not validate.
 */
async function completeWithModel(deps: Required<Pick<AgentDeps, "llm" | "registry">> & { model: string }, history: readonly AgentMessage[], ctx: ToolContext, hostName: string | null): Promise<ModelReply> {
  const { llm, model, registry } = deps;
  const key = modeKey(llm, model);
  let mode: ToolMode = toolModes.get(key) ?? "native";
  const attached = ctx.attachedImage !== undefined;

  if (mode === "native") {
    try {
      const completion = await llm.complete({
        model,
        messages: [{ role: "system", content: buildAgentSystemPrompt({ now: ctx.now, hostName }) }, ...toLlmMessages(history, "native", attached)],
        responseFormat: { type: "text" },
        tools: registry.toLlmTools(),
      });
      toolModes.set(key, "native");
      return { text: completion.text.trim(), toolCalls: completion.toolCalls ?? [], mode: "native" };
    } catch (error) {
      if (!(error instanceof LlmRequestError && error.isBadRequest)) throw error;
      mode = "json";
      toolModes.set(key, "json");
    }
  }

  const system = buildAgentSystemPrompt({ now: ctx.now, hostName, jsonProtocol: { tools: registry.toLlmTools() } });
  let messages: LlmMessage[] = [{ role: "system", content: system }, ...toLlmMessages(history, "json", attached)];
  const formats: LlmResponseFormat[] = [{ type: "json_object" }, { type: "text" }];
  let formatIndex = 0;
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text: string;
    for (;;) {
      try {
        text = (await llm.complete({ model, messages, responseFormat: formats[formatIndex] })).text;
        break;
      } catch (error) {
        if (error instanceof LlmRequestError && error.isBadRequest && formatIndex < formats.length - 1) {
          formatIndex += 1;
          continue;
        }
        throw error;
      }
    }
    try {
      const parsed = JsonProtocolSchema.safeParse(extractJson(stripReasoning(text)));
      if (parsed.success) {
        return {
          text: parsed.data.say.trim(),
          toolCalls: parsed.data.tool_calls.map((call, i) => ({ id: `call_${Date.now().toString(36)}_${i}`, name: call.name, arguments: JSON.stringify(call.args) })),
          mode: "json",
        };
      }
      lastProblem = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (error) {
      lastProblem = describeError(error);
    }
    messages = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: [{ type: "text", text: `Your reply was not valid (${lastProblem}). Reply with ONLY the JSON object {"say": string, "tool_calls": [...]}.` }] },
    ];
  }
  throw new AgentError("invalid_output", `${model} did not follow the tool protocol: ${lastProblem}`);
}

function shouldFallBack(error: unknown): boolean {
  if (error instanceof AgentError) return error.code === "invalid_output";
  return error instanceof LlmRequestError && error.isProviderFailure;
}

async function completeWithFallback(deps: AgentDeps, registry: ToolRegistry, history: readonly AgentMessage[], ctx: ToolContext): Promise<ModelReply> {
  const hostName = deps.hostName ?? null;
  try {
    return await completeWithModel({ llm: deps.llm, registry, model: deps.model }, history, ctx, hostName);
  } catch (error) {
    if (deps.fallbackModel === undefined || !shouldFallBack(error)) throw toAgentError(error);
    try {
      return await completeWithModel({ llm: deps.llm, registry, model: deps.fallbackModel }, history, ctx, hostName);
    } catch (fallbackError) {
      throw toAgentError(fallbackError);
    }
  }
}

function toAgentError(error: unknown): Error {
  if (error instanceof AgentError) return error;
  if (error instanceof LlmRequestError) return new AgentError("llm_request_failed", error.message, error.status);
  return error instanceof Error ? error : new Error(String(error));
}

export interface TurnResult {
  readonly reason: "reply" | "max_steps" | "timeout";
  readonly steps: number;
  readonly actions: readonly AgentAction[];
}

/**
 * Runs the agent on a conversation until the model replies without tool calls
 * or a limit is hit. Expects the triggering message (the host's text, or an
 * action update) to be in the transcript already, so a proactive trigger can
 * reuse it by appending its own message first.
 *
 * Read tools run here; write tools only get their `preview` computed and
 * stored as a pending action. Nothing in this function writes app data.
 */
export async function runTurn(ctx: ToolContext, deps: AgentDeps, conversationId: string, emit: (event: AgentEvent) => void = () => {}): Promise<TurnResult> {
  const registry = deps.registry ?? new ToolRegistry();
  const maxSteps = deps.maxSteps ?? MAX_STEPS;
  const budgetMs = deps.budgetMs ?? TURN_BUDGET_MS;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const actions: AgentAction[] = [];
  const say = async (text: string) => {
    await appendMessage(ctx.db, ctx.hostId, conversationId, { role: "assistant", content: text });
    emit({ type: "text", text });
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (elapsed() >= budgetMs) {
      await say("I ran out of time on this one. Tell me what to do next and I'll pick it up from here.");
      emit({ type: "done", reason: "timeout" });
      return { reason: "timeout", steps: step - 1, actions };
    }
    const history = await listMessages(ctx.db, ctx.hostId, conversationId);
    const reply = await completeWithFallback(deps, registry, history, ctx);

    await appendMessage(ctx.db, ctx.hostId, conversationId, {
      role: "assistant",
      content: reply.text,
      ...(reply.toolCalls.length > 0 ? { toolCalls: reply.toolCalls } : {}),
    });
    if (reply.text.length > 0) emit({ type: "text", text: reply.text });

    if (reply.toolCalls.length === 0) {
      await touchConversation(ctx.db, ctx.hostId, conversationId, { now: new Date() });
      emit({ type: "done", reason: "reply" });
      return { reason: "reply", steps: step, actions };
    }

    for (const call of reply.toolCalls) {
      const result = await handleToolCall(ctx, registry, conversationId, call, actions, emit);
      await appendMessage(ctx.db, ctx.hostId, conversationId, { role: "tool", content: "", toolCallId: call.id, toolResult: toJson(result) });
    }
  }

  await say("I've done as much as I can in one go. Check the cards above and tell me what to do next.");
  emit({ type: "done", reason: "max_steps" });
  return { reason: "max_steps", steps: maxSteps, actions };
}

async function handleToolCall(
  ctx: ToolContext,
  registry: ToolRegistry,
  conversationId: string,
  call: LlmToolCall,
  actions: AgentAction[],
  emit: (event: AgentEvent) => void,
): Promise<unknown> {
  const tool = registry.get(call.name);
  if (!tool) {
    emit({ type: "tool", name: call.name, ok: false });
    return toolErrorResult("unknown_tool", `no tool named ${call.name}`);
  }
  let rawArgs: unknown;
  try {
    rawArgs = call.arguments.trim().length === 0 ? {} : JSON.parse(call.arguments);
  } catch {
    emit({ type: "tool", name: call.name, ok: false });
    return toolErrorResult("invalid_input", "arguments must be a JSON object");
  }
  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    emit({ type: "tool", name: call.name, ok: false });
    return toolErrorResult("invalid_input", "arguments do not match the tool schema", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }

  try {
    if (tool.kind === "read") {
      const result = await tool.run(ctx, parsed.data);
      emit({ type: "tool", name: call.name, ok: true });
      return result;
    }
    const preview = await tool.preview(ctx, parsed.data);
    const action = await createAction(ctx.db, ctx.hostId, {
      conversationId,
      toolCallId: call.id,
      tool: tool.name,
      input: toJson(parsed.data),
      preview,
      previewHash: previewHash(preview),
      now: new Date(),
    });
    actions.push(action);
    emit({ type: "action", action });
    emit({ type: "tool", name: call.name, ok: true });
    return {
      pending_action: { id: action.id, tool: action.tool, title: preview.title, status: "pending", expiresAt: action.expiresAt },
      note: "This write is waiting for the host to approve the action card. It has NOT happened yet. Tell the host what the card will do.",
    };
  } catch (error) {
    emit({ type: "tool", name: call.name, ok: false });
    if (error instanceof ToolError) return toolErrorResult(error.code, error.message, error.details);
    return toolErrorResult("failed", describeError(error));
  }
}
