import { afterEach, describe, expect, it, vi } from "vitest";

import { DINNER_INPUT } from "@/server/interpret/fixtures.test-helpers";

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/interpret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("(i) returns 503 with a clear message when the LLM env vars are unset", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("LLM_MODEL", "");
    const response = await POST(post(DINNER_INPUT));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("llm_unavailable");
    expect(body.error.message).toMatch(/LLM_BASE_URL, LLM_API_KEY and LLM_MODEL/);
  });

  it("(i) returns 400 on a bad body, before checking configuration", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    const response = await POST(post({ note: "hi", participants: [] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_input");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("returns 400 on a non-JSON body", async () => {
    const response = await POST(post("{nope"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
  });
});
