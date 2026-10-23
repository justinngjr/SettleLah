import { describe, expect, it } from "vitest";

import { llmConfigFromEnv, LlmRequestError } from "./client";

describe("llmConfigFromEnv", () => {
  it("returns undefined when any required variable is unset or blank", () => {
    expect(llmConfigFromEnv({})).toBeUndefined();
    expect(llmConfigFromEnv({ LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k" })).toBeUndefined();
    expect(llmConfigFromEnv({ LLM_BASE_URL: "https://x/v1", LLM_API_KEY: " ", LLM_MODEL: "m" })).toBeUndefined();
  });

  it("includes the fallback model only when set and different from the primary", () => {
    const base = { LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k", LLM_MODEL: "m" };
    expect(llmConfigFromEnv(base)).toEqual({ baseURL: "https://x/v1", apiKey: "k", model: "m" });
    expect(llmConfigFromEnv({ ...base, LLM_FALLBACK_MODEL: "" })).toEqual({ baseURL: "https://x/v1", apiKey: "k", model: "m" });
    expect(llmConfigFromEnv({ ...base, LLM_FALLBACK_MODEL: "m" })).toEqual({ baseURL: "https://x/v1", apiKey: "k", model: "m" });
    expect(llmConfigFromEnv({ ...base, LLM_FALLBACK_MODEL: "f" })).toEqual({
      baseURL: "https://x/v1",
      apiKey: "k",
      model: "m",
      fallbackModel: "f",
    });
  });
});

describe("LlmRequestError", () => {
  it("classifies provider failures vs. our own bad requests", () => {
    expect(new LlmRequestError("x").isProviderFailure).toBe(true);
    for (const status of [404, 429, 500, 502, 503]) expect(new LlmRequestError("x", status).isProviderFailure).toBe(true);
    for (const status of [400, 401, 403, 413, 422]) expect(new LlmRequestError("x", status).isProviderFailure).toBe(false);
    expect(new LlmRequestError("x", 400).isBadRequest).toBe(true);
    expect(new LlmRequestError("x", 401).isBadRequest).toBe(false);
  });
});

describe("createOpenAiCaller against a local OpenAI-compatible stub", () => {
  async function withStub(
    handler: (body: { model: string; messages: unknown[]; response_format?: { type: string } }) => { status: number; json: unknown },
    run: (baseURL: string, requests: unknown[]) => Promise<void>,
  ) {
    const { createServer } = await import("node:http");
    const requests: unknown[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        requests.push({ url: req.url, auth: req.headers.authorization, body });
        const { status, json } = handler(body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    try {
      await run(`http://127.0.0.1:${address.port}/v1`, requests);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("sends model, messages (text + image parts) and response_format, and returns the message text", async () => {
    const { createOpenAiCaller } = await import("./client");
    await withStub(
      () => ({ status: 200, json: { choices: [{ message: { role: "assistant", content: '{"ok":true}' } }] } }),
      async (baseURL, requests) => {
        const caller = createOpenAiCaller({ baseURL, apiKey: "test-key" });
        const completion = await caller.complete({
          model: "m1",
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", dataUrl: "data:image/png;base64,AA==" }] },
          ],
          responseFormat: { type: "json_schema", name: "s", schema: { type: "object" } },
        });
        expect(completion.text).toBe('{"ok":true}');
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          url: "/v1/chat/completions",
          auth: "Bearer test-key",
          body: {
            model: "m1",
            temperature: 0,
            response_format: { type: "json_schema", json_schema: { name: "s", schema: { type: "object" } } },
            messages: [
              { role: "system", content: "sys" },
              {
                role: "user",
                content: [
                  { type: "text", text: "hi" },
                  { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
                ],
              },
            ],
          },
        });
      },
    );
  });

  it("maps provider HTTP errors to LlmRequestError with the status", async () => {
    const { createOpenAiCaller } = await import("./client");
    await withStub(
      (body) =>
        body.response_format?.type === "json_schema"
          ? { status: 400, json: { error: { message: "response_format json_schema not supported" } } }
          : { status: 200, json: { choices: [{ message: { role: "assistant", content: "{}" } }] } },
      async (baseURL) => {
        const caller = createOpenAiCaller({ baseURL, apiKey: "k" });
        const messages = [{ role: "system" as const, content: "x" }];
        const rejected = caller.complete({ model: "m", messages, responseFormat: { type: "json_schema", name: "s", schema: {} } });
        await expect(rejected).rejects.toBeInstanceOf(LlmRequestError);
        await expect(rejected).rejects.toMatchObject({ status: 400, isBadRequest: true, isProviderFailure: false });
        const accepted = await caller.complete({ model: "m", messages, responseFormat: { type: "json_object" } });
        expect(accepted.text).toBe("{}");
      },
    );
  });

  it("treats an empty completion as a request failure without a status", async () => {
    const { createOpenAiCaller } = await import("./client");
    await withStub(
      () => ({ status: 200, json: { choices: [{ message: { role: "assistant", content: "" } }] } }),
      async (baseURL) => {
        const caller = createOpenAiCaller({ baseURL, apiKey: "k" });
        await expect(
          caller.complete({ model: "m", messages: [{ role: "system", content: "x" }], responseFormat: { type: "text" } }),
        ).rejects.toMatchObject({ name: "LlmRequestError", status: undefined, isProviderFailure: true });
      },
    );
  });
});
