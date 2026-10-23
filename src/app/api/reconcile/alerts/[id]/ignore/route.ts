import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { ignoreBankAlert } from "@/server/reconcile";
import { errorResponse, readJson, UuidSchema, withHost } from "@/server/reconcile/http";

const BodySchema = z.object({ reason: z.string().trim().max(200).nullish() }).default({});

type Params = { params: Promise<{ id: string }> };

/**
 * POST { reason? } -> 200 { alert } | 404 | 409 already confirmed.
 *
 * Dismisses the alert (status `ignored`, reason defaults to `host_ignored`).
 * The hash is kept so a re-delivered copy stays a duplicate.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  return withHost("api/reconcile/alerts/ignore", async ({ host, db }) => {
    const { id } = await params;
    if (!UuidSchema.safeParse(id).success) return errorResponse(404, "not_found", "unknown alert");
    const body = request.headers.get("content-length") === "0" || request.headers.get("content-type") === null
      ? { ok: true as const, data: {} as z.infer<typeof BodySchema> }
      : await readJson(request, BodySchema);
    if (!body.ok) return body.response;
    const alert = await ignoreBankAlert(db, host.id, id, body.data.reason);
    return NextResponse.json({ alert });
  });
}
