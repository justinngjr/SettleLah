import { describe, expect, it } from "vitest";

import {
  applyRateHalfUp,
  assertChargePolicy,
  computeCharges,
  NO_CHARGES,
  SG_GST_ONLY,
  SG_STANDARD_CHARGES,
  type ChargePolicy,
  type ReceiptTotals,
} from "./charges";
import { MoneyError } from "./money";

describe("applyRateHalfUp", () => {
  it.each([
    // [amount, bps, expected]
    [10000, 1000, 1000], // $100 × 10% = $10.00
    [10000, 900, 900], // $100 × 9% = $9.00
    [5, 1000, 1], // 0.5c rounds up (half-up)
    [4, 1000, 0], // 0.4c rounds down
    [15, 1000, 2], // 1.5c -> 2c
    [25, 1000, 3], // 2.5c -> 3c
    [1, 900, 0], // 0.09c -> 0
    [6, 900, 1], // 0.54c -> 1
    [11843, 1000, 1184], // 1184.3 -> 1184
    [13027, 900, 1172], // 1172.43 -> 1172
    [0, 1000, 0],
    [12345, 0, 0],
    [12345, 10000, 12345],
  ])("applyRateHalfUp(%i, %i bps) = %i", (amount, bps, expected) => {
    expect(applyRateHalfUp(amount, bps)).toBe(expected);
  });

  it.each([
    ["float amount", 12.5, 1000],
    ["negative amount", -1, 1000],
    ["unsafe amount", 2 ** 53, 1000],
    ["float bps", 100, 10.5],
    ["negative bps", 100, -1],
  ])("rejects %s", (_name, amount, bps) => {
    expect(() => applyRateHalfUp(amount, bps)).toThrow(MoneyError);
  });
});

describe("computeCharges", () => {
  const cases: ReadonlyArray<[string, number, ChargePolicy, ReceiptTotals]> = [
    [
      "standard SC + GST on $100",
      10000,
      SG_STANDARD_CHARGES,
      { subtotal: 10000, serviceCharge: 1000, gst: 990, total: 11990 },
    ],
    [
      "GST compounds on service charge, not on subtotal alone",
      11843,
      SG_STANDARD_CHARGES,
      { subtotal: 11843, serviceCharge: 1184, gst: 1172, total: 14199 },
    ],
    ["no service charge", 10000, SG_GST_ONLY, { subtotal: 10000, serviceCharge: 0, gst: 900, total: 10900 }],
    ["GST-inclusive / hawker", 10000, NO_CHARGES, { subtotal: 10000, serviceCharge: 0, gst: 0, total: 10000 }],
    [
      "service charge only",
      10000,
      { serviceChargeBps: 1000, gstBps: 0 },
      { subtotal: 10000, serviceCharge: 1000, gst: 0, total: 11000 },
    ],
    ["zero subtotal", 0, SG_STANDARD_CHARGES, { subtotal: 0, serviceCharge: 0, gst: 0, total: 0 }],
    ["one cent", 1, SG_STANDARD_CHARGES, { subtotal: 1, serviceCharge: 0, gst: 0, total: 1 }],
    ["five cents: SC rounds half-up", 5, SG_STANDARD_CHARGES, { subtotal: 5, serviceCharge: 1, gst: 1, total: 7 }],
    [
      "old 7% GST receipt",
      10000,
      { serviceChargeBps: 1000, gstBps: 700 },
      { subtotal: 10000, serviceCharge: 1000, gst: 770, total: 11770 },
    ],
  ];

  it.each(cases)("%s", (_name, subtotal, policy, expected) => {
    expect(computeCharges(subtotal, policy)).toEqual(expected);
  });

  it("total is always the exact sum of the printed lines", () => {
    for (let subtotal = 0; subtotal < 5000; subtotal += 7) {
      const lines = computeCharges(subtotal, SG_STANDARD_CHARGES);
      expect(lines.total).toBe(lines.subtotal + lines.serviceCharge + lines.gst);
    }
  });

  it("stage-wise rounding means some totals are unreachable (e.g. exactly $142.00)", () => {
    expect(computeCharges(11843, SG_STANDARD_CHARGES).total).toBe(14199);
    expect(computeCharges(11844, SG_STANDARD_CHARGES).total).toBe(14201);
  });

  it.each([
    ["float subtotal", 100.5, SG_STANDARD_CHARGES],
    ["negative subtotal", -100, SG_STANDARD_CHARGES],
    ["unsafe subtotal", Number.MAX_SAFE_INTEGER + 1, SG_STANDARD_CHARGES],
    ["float rate", 100, { serviceChargeBps: 0.1, gstBps: 900 }],
    ["negative rate", 100, { serviceChargeBps: 1000, gstBps: -900 }],
  ])("rejects %s", (_name, subtotal, policy) => {
    expect(() => computeCharges(subtotal, policy)).toThrow(MoneyError);
  });

  it("assertChargePolicy returns the policy when valid", () => {
    expect(assertChargePolicy(SG_STANDARD_CHARGES)).toBe(SG_STANDARD_CHARGES);
  });
});
