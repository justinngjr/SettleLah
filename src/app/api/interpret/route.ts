import "server-only";

import { NextResponse } from "next/server";

import { getHost } from "@/server/auth/session";
import { createOpenAiCaller, llmConfigFromEnv } from "@/server/interpret/client";
import { InterpretError, type InterpretErrorCode } from "@/server/interpret/errors";
import { interpretReceipt } from "@/server/interpret/interpret";
import { InterpretInputSchema, InterpretRequestSchema } from "@/server/interpret/schema";

const STATUS_BY_CODE: Record<InterpretErrorCode, number> = {
  invalid_input: 400,
  unknown_participant: 422,
  invalid_price: 422,
  split_failed: 422,
  invalid_output: 502,
  llm_request_failed: 502,
  llm_unavailable: 503,
};

type ErrorCode = InterpretErrorCode | "invalid_json" | "unauthenticated" | "internal_error";

function errorResponse(status: number, code: ErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

/**
 * POST { image?: dataUrl, receiptText?: string, note: string, participants: {id, name}[] }
 * -> 200 InterpretResult (amounts in cents) | 4xx/5xx { error: { code, message, details? } }.
 *
 * Requires a signed-in host. The host's participant id is their auth user id
 * (derived from the session); a client-sent `hostId` is ignored. Returns a
 * proposal only; nothing is persisted.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const host = await getHost();
  if (!host) return errorResponse(401, "unauthenticated", "sign in required");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "request body must be JSON");
  }

  const parsed = InterpretRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", "invalid request body", parsed.error.issues);
  }
  const { image, receiptText, note, participants } = parsed.data;
  const input = InterpretInputSchema.safeParse({ image, receiptText, note, participants, hostId: host.id });
  if (!input.success) {
    return errorResponse(
      400,
      "invalid_input",
      `participants must include the signed-in host (id ${host.id})`,
      input.error.issues,
    );
  }

  const config = llmConfigFromEnv();
  if (config === undefined) {
    return errorResponse(
      503,
      "llm_unavailable",
      "Receipt interpretation is not configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL on the server.",
    );
  }

  try {
    const result = await interpretReceipt(input.data, {
      llm: createOpenAiCaller(config),
      model: config.model,
      fallbackModel: config.fallbackModel,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InterpretError) {
      return errorResponse(STATUS_BY_CODE[error.code], error.code, error.message, error.details);
    }
    console.error("[api/interpret] unexpected error", error);
    return errorResponse(500, "internal_error", "unexpected error while interpreting the receipt");
  }
}
