import "server-only";

import { NextResponse } from "next/server";

import { createServiceClient } from "@/server/db";
import {
  INBOUND_SECRET_HEADER,
  InboundEmailSchema,
  inboundEmailConfigFromEnv,
  ingestInboundEmail,
  verifyInboundSecret,
} from "@/server/reconcile";
import { errorResponse, handleRouteError, readJson } from "@/server/reconcile/http";

/**
 * POST { to, from, subject, text, html?, headers? } with `X-Inbound-Secret`
 * -> 200 { outcome: "duplicate" | "ignored" | "unmatched" | "proposed" | "confirmed", alertId }
 *  | 401 bad secret | 404 unknown token | 400 bad body | 503 not configured.
 *
 * Public route (no session): the email provider calls it. The host is the
 * owner of the `<token>@INBOUND_EMAIL_DOMAIN` recipient; the raw email is
 * never stored. See README "Inbound email" for provider mappings.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const config = inboundEmailConfigFromEnv();
  if (!config) {
    return errorResponse(
      503,
      "not_configured",
      "Inbound email is not configured: set INBOUND_EMAIL_DOMAIN and INBOUND_EMAIL_SECRET on the server.",
    );
  }
  if (!verifyInboundSecret(request.headers.get(INBOUND_SECRET_HEADER), config.secret)) {
    return errorResponse(401, "unauthenticated", "invalid inbound secret");
  }

  const body = await readJson(request, InboundEmailSchema);
  if (!body.ok) return body.response;

  try {
    const result = await ingestInboundEmail(createServiceClient(), config, body.data);
    return NextResponse.json({
      outcome: result.outcome,
      alertId: result.alert.id,
      ...(result.ledgerEventId ? { ledgerEventId: result.ledgerEventId } : {}),
    });
  } catch (error) {
    return handleRouteError("api/inbound-email", error);
  }
}
