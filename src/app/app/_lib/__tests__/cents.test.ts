import { describe, expect, it } from "vitest";

import { parseDollars, toDollars } from "../cents";
import { dataUrlBytes, downscaleFactor } from "../image";

describe("parseDollars", () => {
  it("accepts common inputs", () => {
    expect(parseDollars("12.50")).toBe(1250);
    expect(parseDollars("$12.5")).toBe(1250);
    expect(parseDollars(" 1,200 ")).toBe(120000);
    expect(parseDollars("0")).toBe(0);
  });
  it("rejects junk", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("12.345")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });
  it("round-trips", () => {
    expect(toDollars(1250)).toBe("12.50");
    expect(parseDollars(toDollars(7))).toBe(7);
  });
});

describe("image helpers", () => {
  it("downscales only when the longest edge exceeds 2000px", () => {
    expect(downscaleFactor(1200, 800)).toBe(1);
    expect(downscaleFactor(4000, 3000)).toBe(0.5);
    expect(downscaleFactor(1000, 8000)).toBe(0.25);
  });
  it("measures decoded bytes of a data URL", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/jpeg;base64,AAA=")).toBe(2);
  });
});
