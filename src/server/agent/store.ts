import "server-only";

import type { LlmToolCall } from "@/server/interpret/client";
import type { DbClient, Enums, Json, Tables, TablesUpdate } from "@/server/db";
import { unwrap, unwrapRequired } from "@/server/db/errors";

import type { ActionPreview } from "./tools";

export type ConversationRow = Tables<"agent_conversations">;
export type MessageRow = Tables<"agent_messages">;
export type ActionRow = Tables<"agent_actions">;
export type ActionStatus = Enums<"agent_action_status">;
export type MessageRole = Enums<"agent_message_role">;

export const ACTION_TTL_MS = 30 * 60 * 1000;

export interface Conversation {
  readonly id: string;
  readonly hostId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly role: MessageRole;
  readonly content: string;
  readonly toolCalls: readonly LlmToolCall[] | null;
  readonly toolCallId: string | null;
  readonly toolResult: Json | null;
  readonly createdAt: string;
}

export interface AgentAction {
  readonly id: string;
  readonly conversationId: string;
  readonly hostId: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly input: Json;
  readonly preview: ActionPreview;
  readonly previewHash: string;
  readonly status: ActionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly result: Json | null;
  readonly error: string | null;
  readonly executedAt: string | null;
  readonly resolvedAt: string | null;
}

export function toConversation(row: ConversationRow): Conversation {
  return { id: row.id, hostId: row.host_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function toMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: Number(row.seq),
    role: row.role,
    content: row.content,
    toolCalls: Array.isArray(row.tool_calls) ? (row.tool_calls as unknown as LlmToolCall[]) : null,
    toolCallId: row.tool_call_id,
    toolResult: row.tool_result,
    createdAt: row.created_at,
  };
}

export function toAction(row: ActionRow): AgentAction {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    hostId: row.host_id,
    toolCallId: row.tool_call_id,
    tool: row.tool,
    input: row.input,
    preview: row.preview as unknown as ActionPreview,
    previewHash: row.preview_hash,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    result: row.result,
    error: row.error,
    executedAt: row.executed_at,
    resolvedAt: row.resolved_at,
  };
}

/** A pending action past `expires_at` reads as expired even before anything marks it. */
export function effectiveStatus(action: AgentAction, now: Date): ActionStatus {
  return action.status === "pending" && new Date(action.expiresAt).getTime() <= now.getTime() ? "expired" : action.status;
}

// Conversations --------------------------------------------------------------

export async function createConversation(db: DbClient, hostId: string, title: string | null = null): Promise<Conversation> {
  const row = unwrapRequired<ConversationRow>(
    await db.from("agent_conversations").insert({ host_id: hostId, title }).select("*").single(),
    "createConversation",
  );
  return toConversation(row);
}

export async function getConversation(db: DbClient, hostId: string, id: string): Promise<Conversation | null> {
  const row = unwrap<ConversationRow>(
    await db.from("agent_conversations").select("*").eq("host_id", hostId).eq("id", id).maybeSingle(),
    "getConversation",
  );
  return row ? toConversation(row) : null;
}

export async function touchConversation(db: DbClient, hostId: string, id: string, patch: { title?: string | null; now: Date }): Promise<void> {
  unwrap(
    await db
      .from("agent_conversations")
      .update({ updated_at: patch.now.toISOString(), ...(patch.title !== undefined ? { title: patch.title } : {}) })
      .eq("host_id", hostId)
      .eq("id", id),
    "touchConversation",
  );
}

// Messages -------------------------------------------------------------------

export interface NewMessage {
  readonly role: MessageRole;
  readonly content: string;
  readonly toolCalls?: readonly LlmToolCall[];
  readonly toolCallId?: string;
  readonly toolResult?: Json;
}

export async function appendMessage(db: DbClient, hostId: string, conversationId: string, message: NewMessage): Promise<AgentMessage> {
  const row = unwrapRequired<MessageRow>(
    await db
      .from("agent_messages")
      .insert({
        conversation_id: conversationId,
        host_id: hostId,
        role: message.role,
        content: message.content,
        tool_calls: message.toolCalls ? (message.toolCalls as unknown as Json) : null,
        tool_call_id: message.toolCallId ?? null,
        tool_result: message.toolResult ?? null,
      })
      .select("*")
      .single(),
    "appendMessage",
  );
  return toMessage(row);
}

export async function listMessages(db: DbClient, hostId: string, conversationId: string): Promise<AgentMessage[]> {
  const rows = unwrap<MessageRow[]>(
    await db.from("agent_messages").select("*").eq("host_id", hostId).eq("conversation_id", conversationId).order("seq", { ascending: true }),
    "listMessages",
  );
  return (rows ?? []).map(toMessage);
}

// Actions --------------------------------------------------------------------

export interface NewAction {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly input: NonNullable<Json>;
  readonly preview: ActionPreview;
  readonly previewHash: string;
  readonly now: Date;
}

export async function createAction(db: DbClient, hostId: string, action: NewAction): Promise<AgentAction> {
  const row = unwrapRequired<ActionRow>(
    await db
      .from("agent_actions")
      .insert({
        conversation_id: action.conversationId,
        host_id: hostId,
        tool_call_id: action.toolCallId,
        tool: action.tool,
        input: action.input,
        preview: action.preview as unknown as NonNullable<Json>,
        preview_hash: action.previewHash,
        created_at: action.now.toISOString(),
        expires_at: new Date(action.now.getTime() + ACTION_TTL_MS).toISOString(),
      })
      .select("*")
      .single(),
    "createAction",
  );
  return toAction(row);
}

export async function getAction(db: DbClient, hostId: string, id: string): Promise<AgentAction | null> {
  const row = unwrap<ActionRow>(await db.from("agent_actions").select("*").eq("host_id", hostId).eq("id", id).maybeSingle(), "getAction");
  return row ? toAction(row) : null;
}

export async function listActions(db: DbClient, hostId: string, conversationId: string): Promise<AgentAction[]> {
  const rows = unwrap<ActionRow[]>(
    await db.from("agent_actions").select("*").eq("host_id", hostId).eq("conversation_id", conversationId).order("created_at", { ascending: true }),
    "listActions",
  );
  return (rows ?? []).map(toAction);
}

/**
 * Atomically moves a pending, unexpired action to `approved`. Exactly one of
 * any number of concurrent approvals gets the row back; the rest get `null`.
 * This is the "lock": `run` is only ever called by the caller that won here.
 */
export async function claimAction(db: DbClient, hostId: string, id: string, now: Date): Promise<AgentAction | null> {
  const rows = unwrap<ActionRow[]>(
    await db
      .from("agent_actions")
      .update({ status: "approved" })
      .eq("host_id", hostId)
      .eq("id", id)
      .eq("status", "pending")
      .gt("expires_at", now.toISOString())
      .select("*"),
    "claimAction",
  );
  return rows && rows.length === 1 ? toAction(rows[0]) : null;
}

export type ActionPatch =
  | { readonly status: "pending"; readonly preview: ActionPreview; readonly previewHash: string }
  | { readonly status: "executed"; readonly result: Json; readonly now: Date }
  | { readonly status: "failed"; readonly error: string; readonly now: Date }
  | { readonly status: "rejected" | "expired"; readonly now: Date };

export async function updateAction(db: DbClient, hostId: string, id: string, patch: ActionPatch): Promise<AgentAction> {
  const values: TablesUpdate<"agent_actions"> =
    patch.status === "pending"
      ? { status: "pending", preview: patch.preview as unknown as NonNullable<Json>, preview_hash: patch.previewHash }
      : patch.status === "executed"
        ? { status: "executed", result: patch.result, executed_at: patch.now.toISOString(), resolved_at: patch.now.toISOString() }
        : patch.status === "failed"
          ? { status: "failed", error: patch.error, resolved_at: patch.now.toISOString() }
          : { status: patch.status, resolved_at: patch.now.toISOString() };
  const row = unwrapRequired<ActionRow>(
    await db.from("agent_actions").update(values).eq("host_id", hostId).eq("id", id).select("*").single(),
    "updateAction",
  );
  return toAction(row);
}
