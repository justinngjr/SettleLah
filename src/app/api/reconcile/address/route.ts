import "server-only";

import { NextResponse } from "next/server";

import { getOrCreateInboundRoute, inboundEmailConfigFromEnv } from "@/server/reconcile";
import { errorResponse, withHost } from "@/server/reconcile/http";

/**
 * GET -> 200 { address, token, domain, createdAt } | 401 | 503 when INBOUND_EMAIL_DOMAIN is unset.
 *
 * The host's secret forwarding address; the `inbound_email_routes` token is
 * created on first call. The host pastes `address` into a Gmail/Outlook
 * filter that forwards only DBS/POSB incoming-transfer alerts.
 */
export async function GET(): Promise<NextResponse> {
  return withHost("api/reconcile/address", async ({ host, db }) => {
    const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
    if (!domain) {
      return errorResponse(503, "not_configured", "Inbound email is not configured: set INBOUND_EMAIL_DOMAIN on the server.");
    }
    const route = await getOrCreateInboundRoute(db, host.id);
    return NextResponse.json({
      address: `${route.token}@${domain}`,
      token: route.token,
      domain,
      createdAt: route.createdAt,
      configured: inboundEmailConfigFromEnv() !== undefined,
    });
  });
}
