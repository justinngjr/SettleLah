import { describe, expect, it } from "vitest";

import {
  bigintToSafeNumber,
  ratio,
  rationalAdd,
  rationalCompare,
  rationalDiv,
  rationalFloor,
  rationalFraction,
  rationalMul,
  rationalSub,
} from "./rational";

const r = (num: number, den = 1) => ratio(num, den);

describe("rational", () => {
  it("normalises sign and common factors", () => {
    expect(r(2, 4)).toEqual(r(1, 2));
    expect(r(1, -2)).toEqual(r(-1, 2));
    expect(r(0, 5)).toEqual(r(0, 1));
    expect(() => r(1, 0)).toThrow(RangeError);
  });

  it.each([
    [r(1, 3), r(1, 6), r(1, 2)],
    [r(1, 2), r(1, 2), r(1)],
    [r(-1, 2), r(1, 2), r(0)],
  ])("add %o + %o = %o", (a, b, expected) => {
    expect(rationalAdd(a, b)).toEqual(expected);
  });

  it("sub / mul / div are exact", () => {
    expect(rationalSub(r(1, 3), r(1, 6))).toEqual(r(1, 6));
    expect(rationalMul(r(2, 3), r(3, 4))).toEqual(r(1, 2));
    expect(rationalDiv(r(1, 3), r(2, 3))).toEqual(r(1, 2));
    expect(() => rationalDiv(r(1), r(0))).toThrow(RangeError);
  });

  it.each([
    [r(7, 2), 3, r(1, 2)],
    [r(-7, 2), -4, r(1, 2)],
    [r(6, 3), 2, r(0)],
    [r(0), 0, r(0)],
    [r(-1, 3), -1, r(2, 3)],
  ])("floor/fraction of %o", (value, floor, fraction) => {
    expect(rationalFloor(value)).toBe(BigInt(floor));
    expect(rationalFraction(value)).toEqual(fraction);
  });

  it("compares exactly where floats would not", () => {
    expect(rationalCompare(r(1, 3), r(333333333333333, 1000000000000000))).toBe(1);
    expect(rationalCompare(r(1, 10), rationalAdd(r(1, 30), r(2, 30)))).toBe(0);
    expect(rationalCompare(r(-1), r(1))).toBe(-1);
  });

  it("bigintToSafeNumber guards the safe range", () => {
    expect(bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1))).toThrow(RangeError);
  });
});
