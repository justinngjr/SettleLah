import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Ledger } from "./balances";
import { balanceOf } from "./balances";
import { MoneyError } from "./money";
import {
  applyRecurringCharge,
  creditCovers,
  nextRunAt,
  recurringCharge,
  RecurringError,
  topUpNeeded,
} from "./recurring";
import { SplitError } from "./split";
import { fromSgt, toSgt } from "./sgt";

const sgt = (y: number, m: number, d: number, h = 0, min = 0) => fromSgt(y, m, d, h, min);
const NINE = 9;

describe("nextRunAt monthly", () => {
  it.each([
    // [from (SGT), anchorDay, expected run (SGT)]
    ["before the anchor this month", sgt(2026, 3, 10, 12), 15, sgt(2026, 3, 15, NINE)],
    ["on the anchor day before 09:00", sgt(2026, 3, 15, 8, 59), 15, sgt(2026, 3, 15, NINE)],
    ["exactly at 09:00 moves to next month (strictly after)", sgt(2026, 3, 15, NINE), 15, sgt(2026, 4, 15, NINE)],
    ["after the anchor this month", sgt(2026, 3, 20), 15, sgt(2026, 4, 15, NINE)],
    ["anchor 31 in January", sgt(2026, 1, 1), 31, sgt(2026, 1, 31, NINE)],
    ["anchor 31 clamps to 28 Feb in a common year", sgt(2026, 1, 31, NINE), 31, sgt(2026, 2, 28, NINE)],
    ["anchor 31 clamps to 29 Feb in a leap year", sgt(2028, 1, 31, NINE), 31, sgt(2028, 2, 29, NINE)],
    ["anchor 29 clamps to 28 Feb in 2100 (not a leap year)", sgt(2100, 2, 1), 29, sgt(2100, 2, 28, NINE)],
    ["anchor 29 hits 29 Feb in 2000 (leap year)", sgt(2000, 2, 1), 29, sgt(2000, 2, 29, NINE)],
    ["after clamped Feb run, March returns to the 31st", sgt(2026, 2, 28, NINE), 31, sgt(2026, 3, 31, NINE)],
    ["anchor 31 clamps to 30 April", sgt(2026, 3, 31, NINE), 31, sgt(2026, 4, 30, NINE)],
    ["anchor 30 in February clamps to 28", sgt(2026, 2, 10), 30, sgt(2026, 2, 28, NINE)],
    ["December rolls into January of next year", sgt(2026, 12, 1, NINE), 1, sgt(2027, 1, 1, NINE)],
    ["anchor 1 just after midnight on the 1st", sgt(2026, 5, 1, 0, 1), 1, sgt(2026, 5, 1, NINE)],
  ])("%s", (_name, from, anchorDay, expected) => {
    expect(nextRunAt({ cadence: "monthly", anchorDay, from }).toISOString()).toBe(expected.toISOString());
  });

  it("uses the Singapore calendar day, not UTC", () => {
    // 2026-03-14T17:00Z is already 15 Mar 01:00 in Singapore; the 15th at 09:00 SGT is still ahead.
    expect(nextRunAt({ cadence: "monthly", anchorDay: 15, from: new Date("2026-03-14T17:00:00Z") }).toISOString()).toBe(
      "2026-03-15T01:00:00.000Z",
    );
    // 2026-03-15T01:00Z is 09:00 SGT exactly -> next month.
    expect(nextRunAt({ cadence: "monthly", anchorDay: 15, from: new Date("2026-03-15T01:00:00Z") }).toISOString()).toBe(
      "2026-04-15T01:00:00.000Z",
    );
  });

  it("is always strictly after `from`, at 09:00 SGT, on the clamped anchor day (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2150, 0, 1) }),
        fc.integer({ min: 1, max: 31 }),
        (ms, anchorDay) => {
          const from = new Date(ms);
          const run = nextRunAt({ cadence: "monthly", anchorDay, from });
          const parts = toSgt(run);
          expect(run.getTime()).toBeGreaterThan(from.getTime());
          expect(parts.hour).toBe(NINE);
          expect(parts.minute).toBe(0);
          expect(parts.day).toBeLessThanOrEqual(anchorDay);
          expect(run.getTime() - from.getTime()).toBeLessThanOrEqual(62 * 24 * 60 * 60 * 1000);
          // Repeating from the run lands on a later month.
          const next = nextRunAt({ cadence: "monthly", anchorDay, from: run });
          const nextParts = toSgt(next);
          expect(nextParts.year * 12 + nextParts.month).toBe(parts.year * 12 + parts.month + 1);
        },
      ),
    );
  });

  it("rejects anchor days outside 1-31", () => {
    expect(() => nextRunAt({ cadence: "monthly", anchorDay: 0, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
    expect(() => nextRunAt({ cadence: "monthly", anchorDay: 32, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
    expect(() => nextRunAt({ cadence: "monthly", anchorDay: 1.5, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
  });
});

describe("nextRunAt weekly", () => {
  // 2026-03-06 is a Friday.
  it.each([
    ["Friday morning, anchor Friday -> today 09:00", sgt(2026, 3, 6, 8), 5, sgt(2026, 3, 6, NINE)],
    ["Friday 09:00, anchor Friday -> next Friday", sgt(2026, 3, 6, NINE), 5, sgt(2026, 3, 13, NINE)],
    ["Friday noon, anchor Sunday -> this Sunday", sgt(2026, 3, 6, 12), 0, sgt(2026, 3, 8, NINE)],
    ["Friday noon, anchor Monday -> Monday 9 Mar", sgt(2026, 3, 6, 12), 1, sgt(2026, 3, 9, NINE)],
    ["Friday noon, anchor Thursday -> Thursday 12 Mar", sgt(2026, 3, 6, 12), 4, sgt(2026, 3, 12, NINE)],
    ["Saturday late, anchor Saturday -> next Saturday", sgt(2026, 3, 7, 23, 59), 6, sgt(2026, 3, 14, NINE)],
    ["crosses a month end", sgt(2026, 3, 30, 12), 3, sgt(2026, 4, 1, NINE)],
    ["crosses a year end", sgt(2026, 12, 31, 12), 5, sgt(2027, 1, 1, NINE)],
  ])("%s", (_name, from, anchorDay, expected) => {
    expect(nextRunAt({ cadence: "weekly", anchorDay, from }).toISOString()).toBe(expected.toISOString());
  });

  it("uses the Singapore weekday, not UTC", () => {
    // 2026-03-07T17:00Z is Saturday in UTC but Sunday 01:00 in Singapore -> Sunday 09:00 SGT today.
    expect(nextRunAt({ cadence: "weekly", anchorDay: 0, from: new Date("2026-03-07T17:00:00Z") }).toISOString()).toBe(
      "2026-03-08T01:00:00.000Z",
    );
  });

  it("is strictly after `from`, within 7 days, on the anchor weekday at 09:00 SGT (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2150, 0, 1) }),
        fc.integer({ min: 0, max: 6 }),
        (ms, anchorDay) => {
          const from = new Date(ms);
          const run = nextRunAt({ cadence: "weekly", anchorDay, from });
          const parts = toSgt(run);
          expect(run.getTime()).toBeGreaterThan(from.getTime());
          expect(run.getTime() - from.getTime()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
          expect(parts.weekday).toBe(anchorDay);
          expect(parts.hour).toBe(NINE);
          expect(parts.minute).toBe(0);
          expect(nextRunAt({ cadence: "weekly", anchorDay, from: run }).getTime() - run.getTime()).toBe(
            7 * 24 * 60 * 60 * 1000,
          );
        },
      ),
    );
  });

  it("rejects anchor days outside 0-6 and unknown cadences", () => {
    expect(() => nextRunAt({ cadence: "weekly", anchorDay: 7, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
    expect(() => nextRunAt({ cadence: "weekly", anchorDay: -1, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
    expect(() => nextRunAt({ cadence: "daily" as never, anchorDay: 1, from: sgt(2026, 1, 1) })).toThrow(RecurringError);
    expect(() => nextRunAt({ cadence: "weekly", anchorDay: 1, from: new Date("nope") })).toThrow(RangeError);
  });
});

describe("recurringCharge", () => {
  const equal = (ids: string[]) => ids.map((id) => ({ id, weight: 1 }));

  it("splits a $17.98 subscription four ways; the 2 leftover cents go to friends, not the host", () => {
    const shares = recurringCharge({ amount: 1798, participants: equal(["alex", "sarah", "ben", "chloe"]), hostId: "alex" });
    expect(shares.map((s) => [s.participantId, s.amount])).toEqual([
      ["alex", 449],
      ["sarah", 450],
      ["ben", 450],
      ["chloe", 449],
    ]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(1798);
  });

  it("the host never absorbs rounding even when they would win the largest-remainder tie-break", () => {
    const shares = recurringCharge({ amount: 1000, participants: equal(["host", "a", "b"]), hostId: "host" });
    expect(shares.find((s) => s.participantId === "host")?.amount).toBe(333);
    expect(shares.filter((s) => s.participantId !== "host").map((s) => s.amount)).toEqual([334, 333]);
  });

  it("honours weights (family plan: host 2 slots, friends 1 each)", () => {
    const shares = recurringCharge({
      amount: 2000,
      participants: [
        { id: "host", weight: 2 },
        { id: "a", weight: 1 },
        { id: "b", weight: 1 },
      ],
      hostId: "host",
    });
    expect(shares.map((s) => s.amount)).toEqual([1000, 500, 500]);
  });

  it("a host who is not a participant is fine; the remainder falls back to the default policy", () => {
    const shares = recurringCharge({ amount: 1000, participants: equal(["a", "b", "c"]), hostId: "host" });
    expect(shares.map((s) => s.amount)).toEqual([334, 333, 333]);
  });

  it("zero amount yields zero shares", () => {
    expect(recurringCharge({ amount: 0, participants: equal(["host", "a"]), hostId: "host" }).map((s) => s.amount)).toEqual([0, 0]);
  });

  it("shares always sum to the amount and the host gets at most the floor of their exact share (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 8 }),
        (amount, weights) => {
          const participants = weights.map((weight, i) => ({ id: `p${i}`, weight }));
          const shares = recurringCharge({ amount, participants, hostId: "p0" });
          expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(amount);
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          const hostFloor = Number((BigInt(amount) * BigInt(weights[0])) / BigInt(totalWeight));
          if (weights.length > 1) expect(shares[0].amount).toBe(hostFloor);
          for (const share of shares) expect(share.amount).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("rejects bad input", () => {
    expect(() => recurringCharge({ amount: 12.5, participants: equal(["a"]), hostId: "a" })).toThrow(MoneyError);
    expect(() => recurringCharge({ amount: -1, participants: equal(["a"]), hostId: "a" })).toThrow(MoneyError);
    expect(() => recurringCharge({ amount: 100, participants: [], hostId: "a" })).toThrow(RecurringError);
    expect(() => recurringCharge({ amount: 100, participants: equal(["a"]), hostId: "" })).toThrow(RecurringError);
    expect(() => recurringCharge({ amount: 100, participants: [{ id: "a", weight: 0 }], hostId: "a" })).toThrow(SplitError);
    expect(() => recurringCharge({ amount: 100, participants: [{ id: "a", weight: 1.5 }], hostId: "a" })).toThrow(SplitError);
    expect(() => recurringCharge({ amount: 100, participants: equal(["a", "a"]), hostId: "a" })).toThrow(SplitError);
  });
});

describe("ledger integration: applyRecurringCharge / topUpNeeded / creditCovers", () => {
  const shares = recurringCharge({ amount: 1798, participants: ["alex", "sarah", "ben"].map((id) => ({ id, weight: 1 })), hostId: "alex" });
  // alex 599 (floor), sarah 600, ben 599

  it("records expense shares for every friend but not the host", () => {
    const ledger = applyRecurringCharge([], shares, "alex", "netflix-2026-03");
    expect(ledger).toEqual([
      { type: "expense_share", friendId: "sarah", amount: 600, ref: "netflix-2026-03" },
      { type: "expense_share", friendId: "ben", amount: 599, ref: "netflix-2026-03" },
    ]);
    expect(balanceOf(ledger, "alex")).toBe(0);
  });

  it("topUpNeeded is the outstanding request after credit is netted off", () => {
    const start: Ledger = [{ type: "credit", friendId: "sarah", amount: 500 }];
    const ledger = applyRecurringCharge(start, shares, "alex");
    expect(topUpNeeded(ledger, "sarah")).toBe(100);
    expect(topUpNeeded(ledger, "ben")).toBe(599);
    expect(topUpNeeded(ledger, "alex")).toBe(0);
    expect(topUpNeeded(ledger, "nobody")).toBe(0);
  });

  it("topUpNeeded is 0 when credit exceeds the share", () => {
    const start: Ledger = [{ type: "payment", friendId: "ben", amount: 2000 }];
    expect(topUpNeeded(applyRecurringCharge(start, shares, "alex"), "ben")).toBe(0);
  });

  it("creditCovers tells whether the next charge needs any payment", () => {
    const ledger: Ledger = [{ type: "credit", friendId: "sarah", amount: 600 }];
    expect(creditCovers(ledger, "sarah", 600)).toBe(true);
    expect(creditCovers(ledger, "sarah", 601)).toBe(false);
    expect(creditCovers(ledger, "sarah", 0)).toBe(true);
    expect(creditCovers([], "sarah", 0)).toBe(true);
    expect(creditCovers([], "sarah", 1)).toBe(false);
    expect(creditCovers([{ type: "expense_share", friendId: "sarah", amount: 100 }], "sarah", 0)).toBe(true);
    expect(() => creditCovers(ledger, "sarah", -1)).toThrow(MoneyError);
    expect(() => creditCovers(ledger, "sarah", 1.5)).toThrow(MoneyError);
  });

  it("charging twice accumulates and the ledger input is not mutated", () => {
    const first = applyRecurringCharge([], shares, "alex");
    const second = applyRecurringCharge(first, shares, "alex");
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(4);
    expect(topUpNeeded(second, "sarah")).toBe(1200);
  });
});
