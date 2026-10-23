import "server-only";

import { depsFromEnv, TelegramNotConfiguredError } from "@/server/telegram/deps";
import { cronSecretFromEnv } from "@/server/telegram/env";
import { runReminders } from "@/server/telegram/reminders";
import { secretsMatch } from "@/server/telegram/webhook";

export const maxDuration = 60;

/**
 * `GET /api/cron/reminders`, invoked by Vercel Cron every 15 minutes with
 * `Authorization: Bearer <CRON_SECRET>`. Public in the route allowlist, so the
 * bearer check here is the only gate. 503 until the env is configured.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = cronSecretFromEnv();
  if (!secret) return Response.json({ error: "cron not configured" }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!secretsMatch(bearer, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const summary = await runReminders(depsFromEnv());
    return Response.json(summary);
  } catch (error) {
    if (error instanceof TelegramNotConfiguredError) return Response.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
