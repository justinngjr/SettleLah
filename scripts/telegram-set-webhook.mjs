#!/usr/bin/env node
// Registers the Telegram webhook: pnpm telegram:set-webhook https://your-app.vercel.app
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment.

const [publicUrl] = process.argv.slice(2);
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!publicUrl || !/^https:\/\//.test(publicUrl)) {
  console.error("usage: pnpm telegram:set-webhook <https public url>");
  process.exit(2);
}
if (!token || !secret) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set");
  process.exit(2);
}

const url = new URL("/api/telegram/webhook", publicUrl).toString();
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});
const body = await response.json();
if (!body.ok) {
  console.error("setWebhook failed:", body.description ?? body);
  process.exit(1);
}
console.log(`webhook set to ${url}`);
