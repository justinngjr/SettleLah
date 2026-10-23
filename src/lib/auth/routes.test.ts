import { describe, expect, it } from "vitest";

import { PUBLIC_API_ROUTES, requiresHost, safeNextPath } from "./routes";

describe("route protection", () => {
  it("protects /app and every /api route", () => {
    expect(requiresHost("/app")).toBe(true);
    expect(requiresHost("/app/friends/1")).toBe(true);
    expect(requiresHost("/api/interpret")).toBe(true);
    expect(requiresHost("/api")).toBe(true);
  });

  it("leaves the public site and auth routes open", () => {
    expect(requiresHost("/")).toBe(false);
    expect(requiresHost("/login")).toBe(false);
    expect(requiresHost("/auth/callback")).toBe(false);
    expect(requiresHost("/auth/signout")).toBe(false);
    expect(requiresHost("/application")).toBe(false);
  });

  it("allows nothing under /api yet", () => {
    expect(PUBLIC_API_ROUTES).toEqual([]);
  });

  it("only accepts same-origin relative next paths", () => {
    expect(safeNextPath("/app/friends?x=1")).toBe("/app/friends?x=1");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
  });
});
