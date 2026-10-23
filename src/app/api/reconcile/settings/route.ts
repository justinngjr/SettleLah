import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getReconcileSettings, updateReconcileSettings } from "@/server/reconcile";
import { readJson, withHost } from "@/server/reconcile/http";

const PatchSchema = z.object({ autoConfirmBankAlerts: z.boolean() });

/** GET -> 200 { autoConfirmBankAlerts } (default false). */
export async function GET(): Promise<NextResponse> {
  return withHost("api/reconcile/settings", async ({ host, db }) => NextResponse.json(await getReconcileSettings(db, host.id)));
}

/**
 * PATCH { autoConfirmBankAlerts } -> 200 { autoConfirmBankAlerts }.
 *
 * Opt-in to auto-confirming the narrow safe case: exact reference match, exact
 * amount, payer name already confirmed for that friend. Off by default.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  return withHost("api/reconcile/settings", async ({ host, db }) => {
    const body = await readJson(request, PatchSchema);
    if (!body.ok) return body.response;
    return NextResponse.json(await updateReconcileSettings(db, host.id, body.data));
  });
}
