import { describe, expect, it } from "vitest";

import { ratio, RATIONAL_ZERO } from "./rational";
import { allocateRemainder, type RemainderCandidate } from "./rounding";

const candidate = (participantId: string, floorCents: number, num: number, den: number): RemainderCandidate => ({
  participantId,
  floorCents,
  fraction: den === 0 ? RATIONAL_ZERO : ratio(num, den),
});

describe("allocateRemainder (largest-remainder, ties by participant order)", () => {
  it.each([
    [
      "no leftover gives nobody anything",
      0,
      [candidate("a", 1, 1, 2), candidate("b", 1, 1, 2)],
      [0, 0],
    ],
    [
      "single cent goes to the largest fraction",
      1,
      [candidate("a", 3, 1, 3), candidate("b", 3, 2, 3)],
      [0, 1],
    ],
    [
      "ties broken by participant order",
      1,
      [candidate("a", 3, 1, 3), candidate("b", 3, 1, 3), candidate("c", 3, 1, 3)],
      [1, 0, 0],
    ],
    [
      "two cents across three equal fractions go to the first two",
      2,
      [candidate("a", 3, 2, 3), candidate("b", 3, 2, 3), candidate("c", 3, 2, 3)],
      [1, 1, 0],
    ],
    [
      "largest fractions win regardless of position",
      2,
      [candidate("a", 0, 1, 10), candidate("b", 0, 9, 10), candidate("c", 0, 5, 10), candidate("d", 0, 7, 10)],
      [0, 1, 0, 1],
    ],
    [
      "fractions with different denominators compare exactly",
      1,
      [candidate("a", 0, 333, 1000), candidate("b", 0, 1, 3)],
      [0, 1],
    ],
    [
      "zero fractions still receive when everyone is tied at zero",
      1,
      [candidate("a", 1, 0, 0), candidate("b", 1, 0, 0)],
      [1, 0],
    ],
    [
      "leftover equal to candidate count gives everyone one",
      3,
      [candidate("a", 0, 1, 2), candidate("b", 0, 1, 2), candidate("c", 0, 1, 2)],
      [1, 1, 1],
    ],
  ])("%s", (_name, leftover, candidates, expected) => {
    const extras = allocateRemainder(leftover, candidates);
    expect(extras).toEqual(expected);
    expect(extras.reduce((a, b) => a + b, 0)).toBe(leftover);
  });

  it("does not mutate or reorder the input", () => {
    const candidates = [candidate("a", 0, 1, 10), candidate("b", 0, 9, 10)];
    const snapshot = JSON.stringify(candidates, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    allocateRemainder(1, candidates);
    expect(JSON.stringify(candidates, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });

  it.each([
    ["more leftover than candidates", 3, [candidate("a", 0, 1, 2), candidate("b", 0, 1, 2)]],
    ["negative leftover", -1, [candidate("a", 0, 1, 2)]],
    ["float leftover", 0.5, [candidate("a", 0, 1, 2)]],
    ["fraction >= 1", 1, [candidate("a", 0, 3, 2)]],
    ["negative fraction", 1, [candidate("a", 0, -1, 2)]],
  ])("rejects %s", (_name, leftover, candidates) => {
    expect(() => allocateRemainder(leftover, candidates)).toThrow();
  });
});
