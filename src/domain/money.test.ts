import { describe, expect, it } from "vitest";

import { assertCents, assertNonNegativeCents, formatSGD, fromDollars, isCents, MoneyError } from "./money";

describe("fromDollars", () => {
  it.each([
    ["0", 0],
    ["12.34", 1234],
    ["12.3", 1230],
    ["12", 1200],
    ["0.05", 5],
    [".99", undefined],
    ["$12.34", 1234],
    [" 12.34 ", 1234],
    ["1,234.56", 123456],
    ["-3.50", -350],
    ["-$0.01", -1],
    ["00012.00", 1200],
  ])("parses %j -> %j", (input, expected) => {
    if (expected === undefined) {
      expect(() => fromDollars(input)).toThrow(MoneyError);
    } else {
      expect(fromDollars(input)).toBe(expected);
    }
  });

  it.each([
    ["three decimal places", "12.345"],
    ["trailing dot", "12."],
    ["empty", ""],
    ["whitespace only", "   "],
    ["letters", "abc"],
    ["exponent", "1e3"],
    ["hex", "0x10"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
    ["internal space", "1 2"],
    ["bad grouping", "12,34.56"],
    ["plus sign", "+5"],
    ["double minus", "--5"],
    ["too large to be exact", "123456789012345678"],
  ])("rejects %s (%j)", (_name, input) => {
    expect(() => fromDollars(input)).toThrow(MoneyError);
  });

  it("rejects non-strings", () => {
    expect(() => fromDollars(12.34 as unknown as string)).toThrow(MoneyError);
  });
});

describe("formatSGD", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [10, "$0.10"],
    [1234, "$12.34"],
    [14200, "$142.00"],
    [123456, "$1,234.56"],
    [100000000, "$1,000,000.00"],
    [-5, "-$0.05"],
    [-123456, "-$1,234.56"],
  ])("formats %j -> %j", (cents, expected) => {
    expect(formatSGD(cents)).toBe(expected);
  });

  it.each([12.34, 0.1, NaN, Infinity, 2 ** 53])("rejects non-integer cents %j", (value) => {
    expect(() => formatSGD(value)).toThrow(MoneyError);
  });

  it("round-trips with fromDollars", () => {
    for (const cents of [0, 1, 99, 100, 1234, 99999, 123456789]) {
      expect(fromDollars(formatSGD(cents))).toBe(cents);
    }
  });
});

describe("cents validation", () => {
  it.each([
    ["float", 12.34],
    ["tiny float", 0.1 + 0.2],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["unsafe integer", 2 ** 53],
    ["negative unsafe integer", -(2 ** 53)],
    ["string", "100"],
    ["bigint", BigInt(100)],
    ["null", null],
    ["undefined", undefined],
  ])("assertCents rejects %s", (_name, value) => {
    expect(isCents(value)).toBe(false);
    expect(() => assertCents(value)).toThrow(MoneyError);
  });

  it.each([0, 1, -1, 2 ** 53 - 1, -(2 ** 53 - 1)])("assertCents accepts safe integer %j", (value) => {
    expect(isCents(value)).toBe(true);
    expect(assertCents(value)).toBe(value);
  });

  it("assertNonNegativeCents rejects negatives and floats but accepts 0", () => {
    expect(() => assertNonNegativeCents(-1, "price")).toThrow(/price must not be negative/);
    expect(() => assertNonNegativeCents(1.5, "price")).toThrow(/price must be an integer/);
    expect(assertNonNegativeCents(0)).toBe(0);
  });
});
