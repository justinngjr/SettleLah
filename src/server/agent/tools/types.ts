import "server-only";

import type { z } from "zod";

import type { DbClient } from "@/server/db";
import type { InterpretDeps } from "@/server/interpret/interpret";
import type { TelegramDeps } from "@/server/telegram";

import type { ActionPreview } from "./preview";

/**
 * Everything a tool may touch. `db` is the signed-in host's RLS client, so a
 * tool can only ever read or write that host's rows. Tools never see the
 * environment: the LLM and Telegram dependencies are injected ready-made.
 */
export interface ToolContext {
  readonly db: DbClient;
  readonly hostId: string;
  readonly now: Date;
  /** Receipt interpretation; `undefined` when the LLM is not configured. */
  readonly interpret?: InterpretDeps;
  /** Lazily built Telegram deps; throws `TelegramNotConfiguredError` when unset. */
  readonly telegram: () => TelegramDeps;
  /** The photo the host attached to this chat turn, as a data URL. Never stored. */
  readonly attachedImage?: string;
}

export type ToolErrorCode = "invalid_input" | "not_found" | "ambiguous" | "invalid_state" | "unavailable" | "failed";

/** A tool's way of telling the model (not the host) that a call cannot proceed. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: unknown;

  constructor(code: ToolErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export type ToolKind = "read" | "write";

interface ToolBase<I> {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType<I>;
}

/** Runs immediately inside the chat loop; its result goes straight back to the model. */
export interface ReadTool<I = unknown, R = unknown> extends ToolBase<I> {
  readonly kind: "read";
  run(ctx: ToolContext, input: I): Promise<R>;
}

/**
 * Never runs inside the chat loop. The loop stores `preview(ctx, input)` as a
 * pending action card; only the approve endpoint calls `run`, after re-running
 * `preview` and checking that it still hashes to what the host approved.
 */
export interface WriteTool<I = unknown, R = unknown> extends ToolBase<I> {
  readonly kind: "write";
  preview(ctx: ToolContext, input: I): Promise<ActionPreview>;
  run(ctx: ToolContext, input: I): Promise<R>;
}

export type Tool<I = unknown, R = unknown> = ReadTool<I, R> | WriteTool<I, R>;

/* Identity helpers that keep the input type attached to the definition. */
export function readTool<I, R>(tool: ReadTool<I, R>): ReadTool<I, R> {
  return tool;
}

export function writeTool<I, R>(tool: WriteTool<I, R>): WriteTool<I, R> {
  return tool;
}
