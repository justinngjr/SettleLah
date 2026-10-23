import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { reassignBankAlert } from "@/server/reconcile";
import { errorResponse, readJson, UuidSchema, withHost } from "@/server/reconcile/http";

const BodySchema = z.object({ paymentRequestId: UuidSchema });

type Params = { params: Promise<{ id: string }> };

/**
 * POST { paymentRequestId } -> 200 { alert } | 404 | 409 request not open / alert already confirmed.
 *
 * Re-points the proposal at another open request (and therefore friend).
 * Nothing hits the ledger until the host confirms.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  return withHost("api/reconcile/alerts/reassign", async ({ host, db }) => {
    const { id } = await params;
    if (!UuidSchema.safeParse(id).success) return errorResponse(404, "not_found", "unknown alert");
    const body = await readJson(request, BodySchema);
    if (!body.ok) return body.response;
    const alert = await reassignBankAlert(db, host.id, id, body.data.paymentRequestId);
    return NextResponse.json({ alert });
  });
}
