import { describe, expect, it } from "vitest";

import { DbError } from "./errors";
import { isProfileComplete, toProfile, updateProfile } from "./profiles";
import type { ProfileRow } from "./profiles";
import { argsOf, chainOf, createMockDb } from "./mock-client.test-helpers";

const ROW: ProfileRow = {
  id: "h1",
  display_name: "Justin",
  paynow_proxy_type: "mobile",
  paynow_proxy_value: "91234567",
  paynow_display_name: "JUSTIN NG",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  auto_confirm_bank_alerts: false,
  telegram_user_id: null,
  telegram_username: null,
};

describe("profiles repository", () => {
  it("maps rows to camelCase Profile objects", () => {
    expect(toProfile(ROW)).toEqual({
      id: "h1",
      displayName: "Justin",
      paynowProxyType: "mobile",
      paynowProxyValue: "91234567",
      paynowDisplayName: "JUSTIN NG",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });

  it("updateProfile upserts on the profile id so a missing row is created", async () => {
    const { db, calls } = createMockDb([{ data: ROW }]);
    const profile = await updateProfile(db, "h1", {
      displayName: "Justin",
      paynow: { proxyType: "mobile", proxyValue: "91234567" },
      paynowDisplayName: "JUSTIN NG",
    });

    expect(calls[0].table).toBe("profiles");
    expect(chainOf(calls[0])).toEqual(["upsert", "select", "single"]);
    expect(argsOf(calls[0], "upsert")).toEqual([
      [
        {
          id: "h1",
          display_name: "Justin",
          paynow_display_name: "JUSTIN NG",
          paynow_proxy_type: "mobile",
          paynow_proxy_value: "91234567",
        },
        { onConflict: "id" },
      ],
    ]);
    expect(profile).toEqual(toProfile(ROW));
  });

  it("updateProfile only sends the fields the patch mentions", async () => {
    const { db, calls } = createMockDb([{ data: ROW }]);
    await updateProfile(db, "h1", { displayName: "Justin" });

    const [payload] = argsOf(calls[0], "upsert")[0];
    expect(payload).toEqual({ id: "h1", display_name: "Justin" });
  });

  it("updateProfile clears both proxy columns when paynow is null", async () => {
    const { db, calls } = createMockDb([{ data: { ...ROW, paynow_proxy_type: null, paynow_proxy_value: null } }]);
    const profile = await updateProfile(db, "h1", { paynow: null });

    const [payload] = argsOf(calls[0], "upsert")[0];
    expect(payload).toEqual({ id: "h1", paynow_proxy_type: null, paynow_proxy_value: null });
    expect(profile.paynowProxyValue).toBeNull();
  });

  it("updateProfile surfaces a database error instead of returning a blank profile", async () => {
    const { db } = createMockDb([{ error: { message: "permission denied", code: "42501" } }]);
    await expect(updateProfile(db, "h1", { displayName: "Justin" })).rejects.toBeInstanceOf(DbError);
  });

  it("isProfileComplete requires a display name, proxy and payee name", () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete({ ...toProfile(ROW), paynowDisplayName: "" })).toBe(false);
    expect(isProfileComplete(toProfile(ROW))).toBe(true);
  });
});
