import { describe, expect, it } from "vitest";

import { assertDate, daysInMonth, fromSgt, isValidDate, sgtDateString, startOfSgtDay, toSgt } from "./sgt";

describe("toSgt / fromSgt", () => {
  it("is UTC+8 with no DST, in January and July alike", () => {
    expect(toSgt(new Date("2026-01-15T16:00:00Z"))).toMatchObject({ year: 2026, month: 1, day: 16, hour: 0, minute: 0 });
    expect(toSgt(new Date("2026-07-15T16:00:00Z"))).toMatchObject({ year: 2026, month: 7, day: 16, hour: 0, minute: 0 });
  });

  it("reports the weekday of the Singapore date, not the UTC date", () => {
    // 2026-10-24 is a Saturday; 16:00Z on Sat is 00:00 Sunday in Singapore.
    const parts = toSgt(new Date("2026-10-24T16:00:00Z"));
    expect(parts).toMatchObject({ day: 25, weekday: 0 });
  });

  it("round-trips", () => {
    const instant = new Date("2026-02-28T13:45:10Z");
    const p = toSgt(instant);
    expect(fromSgt(p.year, p.month, p.day, p.hour, p.minute, p.second).getTime()).toBe(instant.getTime());
  });

  it("fromSgt rolls over out-of-range days like Date.UTC", () => {
    expect(fromSgt(2026, 3, 0).toISOString()).toBe(fromSgt(2026, 2, 28).toISOString());
    expect(fromSgt(2026, 12, 32).toISOString()).toBe(fromSgt(2027, 1, 1).toISOString());
  });

  it("fromSgt rejects non-integer fields", () => {
    expect(() => fromSgt(2026, 1.5, 1)).toThrow(RangeError);
    expect(() => fromSgt(Number.NaN, 1, 1)).toThrow(RangeError);
  });
});

describe("daysInMonth", () => {
  it.each([
    [2024, 2, 29],
    [2025, 2, 28],
    [2100, 2, 28],
    [2000, 2, 29],
    [2026, 1, 31],
    [2026, 4, 30],
    [2026, 12, 31],
  ])("%i-%i has %i days", (year, month, days) => {
    expect(daysInMonth(year, month)).toBe(days);
  });

  it("rejects invalid months", () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe("sgtDateString / startOfSgtDay", () => {
  it("formats the Singapore calendar date", () => {
    expect(sgtDateString(new Date("2026-12-31T16:00:00Z"))).toBe("20270101");
    expect(sgtDateString(new Date("2026-12-31T15:59:59Z"))).toBe("20261231");
  });

  it("startOfSgtDay is 16:00Z of the previous UTC day", () => {
    expect(startOfSgtDay(new Date("2026-10-23T19:59:00Z")).toISOString()).toBe("2026-10-23T16:00:00.000Z");
    expect(startOfSgtDay(new Date("2026-10-23T19:59:00Z"), 1).toISOString()).toBe("2026-10-24T16:00:00.000Z");
  });
});

describe("date validation", () => {
  it("rejects invalid dates and non-dates", () => {
    expect(isValidDate(new Date("nope"))).toBe(false);
    expect(isValidDate("2026-01-01")).toBe(false);
    expect(isValidDate(new Date(0))).toBe(true);
    expect(() => assertDate(new Date("nope"), "now")).toThrow("now must be a valid Date");
    expect(() => toSgt(new Date(Number.NaN))).toThrow(RangeError);
  });
});
