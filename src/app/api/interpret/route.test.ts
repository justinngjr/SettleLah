import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DINNER_INPUT } from "@/server/interpret/fixtures.test-helpers";

const getHost = vi.fn();
const interpretReceipt = vi.fn();

vi.mock("@/server/auth/session", () => ({ getHost }));
vi.mock("@/server/interpret/interpret", () => ({ interpretReceipt }));

const { POST } = await import("./route");

const HOST = { id: "alice", email: "alice@example.com" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stubNoLlm() {
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("LLM_MODEL", "");
}

describe("POST /api/interpret", () => {
  beforeEach(() => {
    getHost.mockResolvedValue(HOST);
    interpretReceipt.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when nobody is signed in, before reading the body", async () => {
    getHost.mockResolvedValue(null);
    const response = await POST(post("{nope"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });

  it("(i) returns 503 with a clear message when the LLM env vars are unset", async () => {
    stubNoLlm();
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

  it("requires the signed-in host to be one of the participants", async () => {
    stubNoLlm();
    getHost.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001", email: null });
    const response = await POST(post(DINNER_INPUT));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.message).toMatch(/signed-in host/);
  });

  it("derives hostId from the session and ignores a client-sent hostId", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_MODEL", "m");
    interpretReceipt.mockResolvedValue({ ok: true });

    const response = await POST(post({ ...DINNER_INPUT, hostId: "bob" }));
    expect(response.status).toBe(200);
    expect(interpretReceipt).toHaveBeenCalledTimes(1);
    expect(interpretReceipt.mock.calls[0][0]).toMatchObject({ hostId: "alice" });

    const again = await POST(post({ ...DINNER_INPUT, hostId: undefined }));
    expect(again.status).toBe(200);
    expect(interpretReceipt.mock.calls[1][0]).toMatchObject({ hostId: "alice" });
  });
});
