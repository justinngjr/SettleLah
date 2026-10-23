import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { listBankAlerts } from "@/server/reconcile";
import { errorResponse, withHost } from "@/server/reconcile/http";

const StatusSchema = z.enum(["unmatched", "proposed", "confirmed", "ignored"]);
const QuerySchema = z.object({
  status: z.array(StatusSchema).min(1).default(["proposed", "unmatched"]),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET ?status=proposed,unmatched&limit=50 -> 200 { alerts: BankAlert[] }
 *
 * The host's inbox: by default the alerts still waiting for a decision
 * (`proposed` with a suggested friend/request, `unmatched` with a reason),
 * newest first. Pass `status=confirmed` / `ignored` for history.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return withHost("api/reconcile/alerts", async ({ host, db }) => {
    const url = new URL(request.url);
    const statusParam = url.searchParams.getAll("status").flatMap((value) => value.split(",")).filter(Boolean);
    const query = QuerySchema.safeParse({
      status: statusParam.length > 0 ? statusParam : undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) return errorResponse(400, "invalid_input", "invalid query", query.error.issues);
    const alerts = await listBankAlerts(db, host.id, { status: query.data.status, limit: query.data.limit });
    return NextResponse.json({ alerts });
  });
}
