import "server-only";

import type { Json } from "@/server/db";

import { runTurn, type AgentDeps, type AgentEvent } from "./loop";
import { appendMessage, claimAction, effectiveStatus, getAction, updateAction, type AgentAction } from "./store";
import { previewHash, ToolError, ToolRegistry, type ToolContext } from "./tools";

export type ApproveOutcome =
  | { readonly kind: "executed"; readonly action: AgentAction }
  | { readonly kind: "already"; readonly action: AgentAction }
  | { readonly kind: "stale_preview"; readonly action: AgentAction }
  | { readonly kind: "expired"; readonly action: AgentAction }
  | { readonly kind: "failed"; readonly action: AgentAction; readonly message: string }
  | { readonly kind: "not_found" };

function describeError(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The only place a write tool's `run` is ever called.
 *
 * 1. Atomically claim the row (pending + unexpired -> approved); a second
 *    approval, or one that lost the race, sees the current row and does nothing.
 * 2. Re-validate the stored input and re-run `preview` against current data.
 *    If the card would read differently now, put the action back to pending
 *    with the new preview and ask the host to approve again.
 * 3. Run the tool once, store the result, mark executed, and tell the
 *    conversation what happened.
 */
export async function approveAction(ctx: ToolContext, actionId: string, registry: ToolRegistry = new ToolRegistry()): Promise<ApproveOutcome> {
  const existing = await getAction(ctx.db, ctx.hostId, actionId);
  if (!existing) return { kind: "not_found" };
  if (existing.status !== "pending") return { kind: "already", action: existing };
  if (effectiveStatus(existing, ctx.now) === "expired") {
    return { kind: "expired", action: await updateAction(ctx.db, ctx.hostId, actionId, { status: "expired", now: ctx.now }) };
  }

  const claimed = await claimAction(ctx.db, ctx.hostId, actionId, ctx.now);
  if (!claimed) {
    const current = await getAction(ctx.db, ctx.hostId, actionId);
    return current ? { kind: "already", action: current } : { kind: "not_found" };
  }

  const tool = registry.getWrite(claimed.tool);
  if (!tool) return fail(ctx, claimed, `tool ${claimed.tool} is no longer available`);

  const parsed = tool.input.safeParse(claimed.input);
  if (!parsed.success) return fail(ctx, claimed, "the stored input no longer validates");

  let preview;
  try {
    preview = await tool.preview(ctx, parsed.data);
  } catch (error) {
    return fail(ctx, claimed, `could not re-check this action: ${describeError(error)}`);
  }
  const hash = previewHash(preview);
  if (hash !== claimed.previewHash) {
    const action = await updateAction(ctx.db, ctx.hostId, actionId, { status: "pending", preview, previewHash: hash });
    return { kind: "stale_preview", action };
  }

  try {
    const result = await tool.run(ctx, parsed.data);
    const action = await updateAction(ctx.db, ctx.hostId, actionId, { status: "executed", result: toJson(result), now: new Date() });
    await appendMessage(ctx.db, ctx.hostId, action.conversationId, {
      role: "user",
      content: `The host approved "${action.preview.title}" and it executed. Result: ${JSON.stringify(result)}`,
      toolResult: { kind: "action_result", actionId: action.id, status: "executed" },
    });
    return { kind: "executed", action };
  } catch (error) {
    return fail(ctx, claimed, describeError(error));
  }
}

async function fail(ctx: ToolContext, claimed: AgentAction, message: string): Promise<ApproveOutcome> {
  const action = await updateAction(ctx.db, ctx.hostId, claimed.id, { status: "failed", error: message, now: new Date() });
  await appendMessage(ctx.db, ctx.hostId, action.conversationId, {
    role: "user",
    content: `The host approved "${action.preview.title}" but it failed: ${message}`,
    toolResult: { kind: "action_result", actionId: action.id, status: "failed" },
  });
  return { kind: "failed", action, message };
}

export type RejectOutcome = { readonly kind: "rejected" | "already"; readonly action: AgentAction } | { readonly kind: "not_found" };

export async function rejectAction(ctx: ToolContext, actionId: string): Promise<RejectOutcome> {
  const existing = await getAction(ctx.db, ctx.hostId, actionId);
  if (!existing) return { kind: "not_found" };
  if (existing.status !== "pending") return { kind: "already", action: existing };
  const action = await updateAction(ctx.db, ctx.hostId, actionId, { status: "rejected", now: ctx.now });
  await appendMessage(ctx.db, ctx.hostId, action.conversationId, {
    role: "user",
    content: `The host declined "${action.preview.title}". Do not do it unless asked again.`,
    toolResult: { kind: "action_result", actionId: action.id, status: "rejected" },
  });
  return { kind: "rejected", action };
}

/** After an approval or rejection, let the agent say one thing about it (same loop as chat). */
export async function followUp(ctx: ToolContext, deps: AgentDeps, conversationId: string, emit: (event: AgentEvent) => void): Promise<void> {
  await runTurn(ctx, deps, conversationId, emit);
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null));
}
