import "server-only";

import { createServiceClient } from "@/server/db";
import { runDueRecurring } from "@/server/recurring";
import { depsFromEnv } from "@/server/telegram/deps";
import { cronSecretFromEnv, telegramConfigFromEnv } from "@/server/telegram/env";
import { notifySplit } from "@/server/telegram/notify";
import { secretsMatch } from "@/server/telegram/webhook";

export const maxDuration = 60;

/**
 * `GET /api/cron/recurring`, invoked by Vercel Cron hourly with
 * `Authorization: Bearer <CRON_SECRET>`. Public in the route allowlist, so the
 * constant-time bearer check here is the only gate. Charges every recurring
 * expense whose `next_run_at` has passed; posting to Telegram is best-effort
 * and skipped entirely when the bot is not configured.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = cronSecretFromEnv();
  if (!secret) return Response.json({ error: "cron not configured" }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!secretsMatch(bearer, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const telegram = telegramConfigFromEnv();
  const summary = await runDueRecurring({
    db: createServiceClient(),
    notify: telegram ? (input) => notifySplit(input, depsFromEnv()) : undefined,
  });
  return Response.json(summary);
}
