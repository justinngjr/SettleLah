import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DBS_PAYNOW_AUTOFORWARD } from "@/server/reconcile/fixtures.test-helpers";
import { ReconcileError } from "@/server/reconcile/types";

const ingestInboundEmail = vi.fn();
const createServiceClient = vi.fn(() => ({ mocked: true }));

vi.mock("@/server/db", () => ({ createServiceClient, DbError: class DbError extends Error {} }));
vi.mock("@/server/reconcile/ingest", () => ({ ingestInboundEmail, INGEST_REASONS: {} }));

const { POST } = await import("./route");

function post(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-inbound-secret"] = secret;
  return new Request("http://localhost/api/inbound-email", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/inbound-email", () => {
  beforeEach(() => {
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "in.settlelah.test");
    vi.stubEnv("INBOUND_EMAIL_SECRET", "topsecret");
    ingestInboundEmail.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns 503 when the inbound env vars are unset, before checking the secret", async () => {
    vi.stubEnv("INBOUND_EMAIL_SECRET", "");
    const response = await POST(post(DBS_PAYNOW_AUTOFORWARD, "topsecret"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("not_configured");
    expect(ingestInboundEmail).not.toHaveBeenCalled();
  });

  it("returns 401 on a missing or wrong secret without reading the body", async () => {
    expect((await POST(post(DBS_PAYNOW_AUTOFORWARD))).status).toBe(401);
    expect((await POST(post(DBS_PAYNOW_AUTOFORWARD, "topsecret2"))).status).toBe(401);
    expect((await POST(post("{nope", "wrong"))).status).toBe(401);
    expect(ingestInboundEmail).not.toHaveBeenCalled();
  });

  it("returns 400 on non-JSON or a body without to/from", async () => {
    expect((await POST(post("{nope", "topsecret"))).status).toBe(400);
    const response = await POST(post({ subject: "x" }, "topsecret"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_input");
  });

  it("ingests with the service client and the env config, returning the outcome", async () => {
    ingestInboundEmail.mockResolvedValue({ outcome: "proposed", alert: { id: "a1" } });
    const response = await POST(post({ ...DBS_PAYNOW_AUTOFORWARD, provider_extra: 1 }, "topsecret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "proposed", alertId: "a1" });
    expect(createServiceClient).toHaveBeenCalled();
    const [db, config, email] = ingestInboundEmail.mock.calls[0];
    expect(db).toEqual({ mocked: true });
    expect(config).toMatchObject({ domain: "in.settlelah.test", senderAllowlist: ["dbs.com"] });
    expect(email).toMatchObject({ to: DBS_PAYNOW_AUTOFORWARD.to, text: DBS_PAYNOW_AUTOFORWARD.text });
  });

  it("maps an unknown token to 404 and unexpected failures to 500", async () => {
    ingestInboundEmail.mockRejectedValueOnce(new ReconcileError("not_found", "unknown or revoked forwarding address"));
    expect((await POST(post(DBS_PAYNOW_AUTOFORWARD, "topsecret"))).status).toBe(404);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    ingestInboundEmail.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(post(DBS_PAYNOW_AUTOFORWARD, "topsecret"))).status).toBe(500);
    spy.mockRestore();
  });
});
