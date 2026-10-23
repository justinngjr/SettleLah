import "server-only";

import { handleTelegramWebhook } from "@/server/telegram/webhook";


/** Telegram pushes updates here; see `src/server/telegram/webhook.ts`. */
export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request);
}
