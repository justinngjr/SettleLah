import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReconcileError } from "@/server/reconcile/types";

const getHost = vi.fn();
const createDbClient = vi.fn(async () => ({ mocked: true }));
const store = {
  getOrCreateInboundRoute: vi.fn(),
  listBankAlerts: vi.fn(),
  getReconcileSettings: vi.fn(),
  updateReconcileSettings: vi.fn(),
};
const actions = { confirmBankAlert: vi.fn(), reassignBankAlert: vi.fn(), ignoreBankAlert: vi.fn() };

vi.mock("@/server/auth/session", () => ({ getHost }));
vi.mock("@/server/db", () => ({ createDbClient, DbError: class DbError extends Error {} }));
vi.mock("@/server/reconcile/store", () => store);
vi.mock("@/server/reconcile/actions", () => ({ ...actions, HOST_IGNORED_REASON: "host_ignored" }));

const address = await import("./address/route");
const alerts = await import("./alerts/route");
const confirm = await import("./alerts/[id]/confirm/route");
const reassign = await import("./alerts/[id]/reassign/route");
const ignore = await import("./alerts/[id]/ignore/route");
const settings = await import("./settings/route");

const HOST = { id: "00000000-0000-4000-8000-00000000aaaa", email: null };
const ALERT_ID = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000e1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/reconcile${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/reconcile/*", () => {
  beforeEach(() => {
    getHost.mockResolvedValue(HOST);
    for (const fn of [...Object.values(store), ...Object.values(actions)]) fn.mockReset();
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "in.settlelah.test");
    vi.stubEnv("INBOUND_EMAIL_SECRET", "s");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("every endpoint returns 401 when nobody is signed in", async () => {
    getHost.mockResolvedValue(null);
    const responses = await Promise.all([
      address.GET(),
      alerts.GET(req("/alerts", "GET")),
      confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST", {}), params(ALERT_ID)),
      reassign.POST(req(`/alerts/${ALERT_ID}/reassign`, "POST", { paymentRequestId: REQUEST_ID }), params(ALERT_ID)),
      ignore.POST(req(`/alerts/${ALERT_ID}/ignore`, "POST", {}), params(ALERT_ID)),
      settings.GET(),
      settings.PATCH(req("/settings", "PATCH", { autoConfirmBankAlerts: true })),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    expect(createDbClient).not.toHaveBeenCalled();
  });

  it("GET /address creates the token on first call and formats the address; 503 without the domain", async () => {
    store.getOrCreateInboundRoute.mockResolvedValue({ token: "abc123abc123abc123", createdAt: "2026-01-01T00:00:00Z" });
    const response = await address.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      address: "abc123abc123abc123@in.settlelah.test",
      token: "abc123abc123abc123",
      domain: "in.settlelah.test",
      createdAt: "2026-01-01T00:00:00Z",
      configured: true,
    });
    expect(store.getOrCreateInboundRoute).toHaveBeenCalledWith({ mocked: true }, HOST.id);

    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "");
    expect((await address.GET()).status).toBe(503);
  });

  it("GET /alerts defaults to proposed+unmatched and parses status/limit", async () => {
    store.listBankAlerts.mockResolvedValue([]);
    expect((await alerts.GET(req("/alerts", "GET"))).status).toBe(200);
    expect(store.listBankAlerts).toHaveBeenLastCalledWith({ mocked: true }, HOST.id, { status: ["proposed", "unmatched"], limit: 50 });
    await alerts.GET(req("/alerts?status=confirmed,ignored&limit=5", "GET"));
    expect(store.listBankAlerts).toHaveBeenLastCalledWith({ mocked: true }, HOST.id, { status: ["confirmed", "ignored"], limit: 5 });
    expect((await alerts.GET(req("/alerts?status=bogus", "GET"))).status).toBe(400);
  });

  it("POST /alerts/:id/confirm forwards the host id and optional request; maps domain errors", async () => {
    actions.confirmBankAlert.mockResolvedValue({ alert: { id: ALERT_ID }, claimId: "c", ledgerEventId: "l", paymentRequest: { id: REQUEST_ID } });
    const response = await confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST", { paymentRequestId: REQUEST_ID }), params(ALERT_ID));
    expect(response.status).toBe(200);
    expect(actions.confirmBankAlert).toHaveBeenCalledWith({ mocked: true }, HOST.id, ALERT_ID, { paymentRequestId: REQUEST_ID });

    // No body at all is fine (confirm the proposal as-is).
    await confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST"), params(ALERT_ID));
    expect(actions.confirmBankAlert).toHaveBeenLastCalledWith({ mocked: true }, HOST.id, ALERT_ID, { paymentRequestId: undefined });

    expect((await confirm.POST(req(`/alerts/x/confirm`, "POST", {}), params("x"))).status).toBe(404);
    expect((await confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST", { paymentRequestId: "nope" }), params(ALERT_ID))).status).toBe(400);

    actions.confirmBankAlert.mockRejectedValueOnce(new ReconcileError("invalid_state", "already confirmed"));
    const conflict = await confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST", {}), params(ALERT_ID));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("invalid_state");
    actions.confirmBankAlert.mockRejectedValueOnce(new ReconcileError("not_found", "nope"));
    expect((await confirm.POST(req(`/alerts/${ALERT_ID}/confirm`, "POST", {}), params(ALERT_ID))).status).toBe(404);
  });

  it("POST /alerts/:id/reassign requires paymentRequestId", async () => {
    actions.reassignBankAlert.mockResolvedValue({ id: ALERT_ID });
    expect((await reassign.POST(req(`/alerts/${ALERT_ID}/reassign`, "POST", {}), params(ALERT_ID))).status).toBe(400);
    const ok = await reassign.POST(req(`/alerts/${ALERT_ID}/reassign`, "POST", { paymentRequestId: REQUEST_ID }), params(ALERT_ID));
    expect(ok.status).toBe(200);
    expect(actions.reassignBankAlert).toHaveBeenCalledWith({ mocked: true }, HOST.id, ALERT_ID, REQUEST_ID);
  });

  it("POST /alerts/:id/ignore accepts an optional reason", async () => {
    actions.ignoreBankAlert.mockResolvedValue({ id: ALERT_ID, status: "ignored" });
    expect((await ignore.POST(req(`/alerts/${ALERT_ID}/ignore`, "POST"), params(ALERT_ID))).status).toBe(200);
    expect(actions.ignoreBankAlert).toHaveBeenLastCalledWith({ mocked: true }, HOST.id, ALERT_ID, undefined);
    await ignore.POST(req(`/alerts/${ALERT_ID}/ignore`, "POST", { reason: "refund" }), params(ALERT_ID));
    expect(actions.ignoreBankAlert).toHaveBeenLastCalledWith({ mocked: true }, HOST.id, ALERT_ID, "refund");
  });

  it("settings GET/PATCH", async () => {
    store.getReconcileSettings.mockResolvedValue({ autoConfirmBankAlerts: false });
    expect(await (await settings.GET()).json()).toEqual({ autoConfirmBankAlerts: false });
    store.updateReconcileSettings.mockResolvedValue({ autoConfirmBankAlerts: true });
    const response = await settings.PATCH(req("/settings", "PATCH", { autoConfirmBankAlerts: true }));
    expect(await response.json()).toEqual({ autoConfirmBankAlerts: true });
    expect(store.updateReconcileSettings).toHaveBeenCalledWith({ mocked: true }, HOST.id, { autoConfirmBankAlerts: true });
    expect((await settings.PATCH(req("/settings", "PATCH", { autoConfirmBankAlerts: "yes" }))).status).toBe(400);
  });
});
