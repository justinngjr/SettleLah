import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { confirmBankAlert } from "@/server/reconcile";
import { errorResponse, readJson, UuidSchema, withHost } from "@/server/reconcile/http";

const BodySchema = z.object({ paymentRequestId: UuidSchema.nullish() }).default({});

type Params = { params: Promise<{ id: string }> };

/**
 * POST { paymentRequestId? } -> 200 { alert, claimId, ledgerEventId, paymentRequest }
 *  | 404 unknown alert/request | 409 already confirmed, request not open | 400 unmatched and no request given.
 *
 * The one tap: writes exactly one `payment` ledger event for the alert
 * amount (via `confirm_payment_claim`), marks the alert confirmed and
 * remembers the payer name in the friend's `known_bank_names`. Send
 * `paymentRequestId` to confirm against a different request than proposed.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  return withHost("api/reconcile/alerts/confirm", async ({ host, db }) => {
    const { id } = await params;
    if (!UuidSchema.safeParse(id).success) return errorResponse(404, "not_found", "unknown alert");
    const body = request.headers.get("content-length") === "0" || request.headers.get("content-type") === null
      ? { ok: true as const, data: {} as z.infer<typeof BodySchema> }
      : await readJson(request, BodySchema);
    if (!body.ok) return body.response;
    const result = await confirmBankAlert(db, host.id, id, { paymentRequestId: body.data.paymentRequestId });
    return NextResponse.json(result);
  });
}
