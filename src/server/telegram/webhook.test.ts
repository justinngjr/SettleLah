import { describe, expect, it } from "vitest";

import { textUpdate, user } from "./fake-api.test-helpers";
import { CONFIG, setup } from "./setup.test-helpers";
import { handleTelegramWebhook, secretsMatch } from "./webhook";

function post(body: unknown, secret?: string): Request {
  return new Request("https://example.test/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify(body),
  });
}

describe("webhook", () => {
  it("answers 503 when the bot is not configured", async () => {
    const saved = { ...process.env };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      const response = await handleTelegramWebhook(post({ update_id: 1 }, "x"));
      expect(response.status).toBe(503);
    } finally {
      process.env = saved;
    }
  });

  it("rejects a missing or wrong secret header without touching the bot", async () => {
    const w = setup();
    const update = textUpdate(user(1), 1, "/start");
    expect((await handleTelegramWebhook(post(update), { deps: w.deps, webhookSecret: CONFIG.webhookSecret })).status).toBe(401);
    expect((await handleTelegramWebhook(post(update, "nope"), { deps: w.deps, webhookSecret: CONFIG.webhookSecret })).status).toBe(401);
    expect(w.tg.calls).toHaveLength(0);
  });

  it("handles the update with the right secret", async () => {
    const w = setup();
    const response = await handleTelegramWebhook(post(textUpdate(user(1), 1, "/start"), CONFIG.webhookSecret), {
      deps: w.deps,
      webhookSecret: CONFIG.webhookSecret,
    });
    expect(response.status).toBe(200);
    expect(w.tg.sent()).toHaveLength(1);
    expect(w.tg.sent()[0].payload.chat_id).toBe(1);
  });

  it("secretsMatch is strict", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abd", "abc")).toBe(false);
    expect(secretsMatch("abcd", "abc")).toBe(false);
    expect(secretsMatch(null, "abc")).toBe(false);
  });
});
