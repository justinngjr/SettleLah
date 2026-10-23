import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getHost, type Host } from "@/server/auth/session";
import { createDbClient, DbError, type DbClient } from "@/server/db";

import { ReconcileError, type ReconcileErrorCode } from "./types";

export type ApiErrorCode =
  | ReconcileErrorCode
  | "invalid_json"
  | "unauthenticated"
  | "forbidden"
  | "internal_error";

const STATUS_BY_CODE: Record<ReconcileErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  invalid_state: 409,
  ambiguous: 409,
  not_configured: 503,
};

export function errorResponse(status: number, code: ApiErrorCode, message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json", "request body must be JSON") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: errorResponse(400, "invalid_input", "invalid request body", parsed.error.issues) };
  }
  return { ok: true, data: parsed.data };
}

/** Maps domain/DB failures to a JSON error; anything else is logged and becomes a 500. */
export function handleRouteError(scope: string, error: unknown): NextResponse {
  if (error instanceof ReconcileError) {
    return errorResponse(STATUS_BY_CODE[error.code], error.code, error.message, error.details);
  }
  if (error instanceof DbError) {
    // The RPCs raise `no_data_found` / `invalid state` style errors with a readable message.
    if (error.code === "P0002") return errorResponse(404, "not_found", error.message);
    if (error.code === "P0001" || error.code === "23514" || error.code === "23503") {
      return errorResponse(409, "invalid_state", error.message);
    }
  }
  console.error(`[${scope}] unexpected error`, error);
  return errorResponse(500, "internal_error", "unexpected error");
}

export interface HostContext {
  readonly host: Host;
  readonly db: DbClient;
}

/**
 * Runs an authenticated handler as the signed-in host with an RLS client.
 * Every repository call still passes `host.id` explicitly.
 */
export async function withHost(scope: string, handler: (ctx: HostContext) => Promise<NextResponse>): Promise<NextResponse> {
  const host = await getHost();
  if (!host) return errorResponse(401, "unauthenticated", "sign in required");
  try {
    const db = await createDbClient();
    return await handler({ host, db });
  } catch (error) {
    return handleRouteError(scope, error);
  }
}

export const UuidSchema = z.string().uuid();
