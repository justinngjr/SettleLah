import "server-only";

import { NextResponse } from "next/server";

import type { ActionDto, AgentStreamEvent, MessageDto } from "@/app/app/agent/_lib/types";
import { getHost, type Host } from "@/server/auth/session";
import { createDbClient, type DbClient } from "@/server/db";
import { getProfile } from "@/server/db";

import { agentDepsFromEnv, buildToolContext } from "./deps";
import type { AgentDeps, AgentEvent } from "./loop";
import { effectiveStatus, type AgentAction, type AgentMessage } from "./store";
import type { ToolContext } from "./tools";

export type AgentApiErrorCode = "unauthenticated" | "invalid_json" | "invalid_input" | "not_found" | "llm_unavailable" | "internal_error";

export function errorResponse(status: number, code: AgentApiErrorCode, message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

export const LLM_UNAVAILABLE_MESSAGE =
  "The assistant is not available right now. You can still log a receipt, record payments and manage friends from the app screens.";

export interface AgentRequestContext {
  readonly host: Host;
  readonly db: DbClient;
  readonly deps: AgentDeps;
  readonly ctx: ToolContext;
}

/**
 * Signed-in host + RLS client + model access, or an error response: 401 when
 * signed out, 503 when the LLM env is not configured.
 */
export async function withAgent(
  scope: string,
  handler: (ctx: AgentRequestContext) => Promise<Response>,
  options: { readonly attachedImage?: string } = {},
): Promise<Response> {
  const host = await getHost();
  if (!host) return errorResponse(401, "unauthenticated", "sign in required");
  const deps = agentDepsFromEnv();
  if (!deps) return errorResponse(503, "llm_unavailable", LLM_UNAVAILABLE_MESSAGE);
  try {
    const db = await createDbClient();
    const profile = await getProfile(db, host.id);
    const agent: AgentDeps = { ...deps, hostName: profile?.displayName ?? null };
    const ctx = buildToolContext({ db, hostId: host.id, agent, ...(options.attachedImage ? { attachedImage: options.attachedImage } : {}) });
    return await handler({ host, db, deps: agent, ctx });
  } catch (error) {
    console.error(`[${scope}]`, error);
    return errorResponse(500, "internal_error", "something went wrong");
  }
}

export function toActionDto(action: AgentAction, now: Date, needsReapproval = false): ActionDto {
  return {
    id: action.id,
    conversationId: action.conversationId,
    tool: action.tool,
    preview: action.preview,
    status: effectiveStatus(action, now),
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
    executedAt: action.executedAt,
    error: action.error,
    ...(needsReapproval ? { needsReapproval: true } : {}),
  };
}

export function toMessageDto(message: AgentMessage): MessageDto {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    system: message.role === "user" && message.toolResult !== null,
    createdAt: message.createdAt,
  };
}

export function loopEventToStream(event: AgentEvent, now: Date): AgentStreamEvent {
  switch (event.type) {
    case "text":
      return { type: "text", text: event.text };
    case "tool":
      return { type: "tool", name: event.name, ok: event.ok };
    case "action":
      return { type: "action", action: toActionDto(event.action, now) };
    case "done":
      return { type: "done", reason: event.reason };
  }
}

/** Runs `produce` while streaming its events as SSE (`event: <type>`, `data: <json>`). */
export function sseResponse(produce: (emit: (event: AgentStreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await produce(emit);
      } catch (error) {
        console.error("[api/agent stream]", error);
        const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "internal_error";
        emit({ type: "error", code, message: error instanceof Error ? error.message : "something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
