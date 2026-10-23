import { describe, expect, it } from "vitest";

import { argsOf, chainOf, createMockDb } from "@/server/db/mock-client.test-helpers";

import { HOST_ID, routeRow } from "./rows.test-helpers";
import { generateInboundToken, getOrCreateInboundRoute, getReconcileSettings, listBankAlerts, updateReconcileSettings } from "./store";

describe("inbound routes", () => {
  it("tokens are 32 hex chars (>= 16 required by the schema)", () => {
    expect(generateInboundToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateInboundToken(() => new Uint8Array(16))).toBe("0".repeat(32));
  });

  it("returns the host's active route when one exists", async () => {
    const { db, calls } = createMockDb([{ data: routeRow() }]);
    const route = await getOrCreateInboundRoute(db, HOST_ID);
    expect(route.token).toBe(routeRow().token);
    expect(calls).toHaveLength(1);
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", HOST_ID]]);
    expect(argsOf(calls[0], "is")).toEqual([["revoked_at", null]]);
  });

  it("creates the token on first call", async () => {
    const { db, calls } = createMockDb([{ data: null }, { data: routeRow({ token: "f".repeat(32) }) }]);
    const route = await getOrCreateInboundRoute(db, HOST_ID, () => "f".repeat(32));
    expect(route.token).toBe("f".repeat(32));
    expect(argsOf(calls[1], "insert")[0][0]).toEqual({ host_id: HOST_ID, token: "f".repeat(32) });
  });
});

describe("settings", () => {
  it("defaults to auto-confirm off when the profile row is missing", async () => {
    const { db, calls } = createMockDb([{ data: null }]);
    expect(await getReconcileSettings(db, HOST_ID)).toEqual({ autoConfirmBankAlerts: false });
    expect(calls[0].table).toBe("profiles");
    expect(argsOf(calls[0], "eq")).toEqual([["id", HOST_ID]]);
  });

  it("updates only the host's profile", async () => {
    const { db, calls } = createMockDb([{ data: { auto_confirm_bank_alerts: true } }]);
    expect(await updateReconcileSettings(db, HOST_ID, { autoConfirmBankAlerts: true })).toEqual({ autoConfirmBankAlerts: true });
    expect(argsOf(calls[0], "update")[0][0]).toEqual({ auto_confirm_bank_alerts: true });
    expect(argsOf(calls[0], "eq")).toEqual([["id", HOST_ID]]);
  });
});

describe("listBankAlerts", () => {
  it("filters by host and status list, newest first", async () => {
    const { db, calls } = createMockDb([{ data: [] }]);
    await listBankAlerts(db, HOST_ID, { status: ["proposed", "unmatched"], limit: 10 });
    expect(chainOf(calls[0])).toEqual(["select", "eq", "order", "in", "limit"]);
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", HOST_ID]]);
    expect(argsOf(calls[0], "in")).toEqual([["status", ["proposed", "unmatched"]]]);
  });
});
