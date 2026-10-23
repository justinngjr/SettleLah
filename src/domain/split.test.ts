import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { NO_CHARGES, SG_GST_ONLY, SG_STANDARD_CHARGES, type ChargePolicy } from "./charges";
import { MoneyError } from "./money";
import type { RemainderPolicy } from "./rounding";
import { splitReceipt, SplitError, type ExclusionRedistribution, type LineItem, type SplitInput } from "./split";

const sumShares = (input: SplitInput) =>
  splitReceipt(input).shares.reduce((sum, share) => sum + share.amount, 0);

const amountsOf = (input: SplitInput) =>
  Object.fromEntries(splitReceipt(input).shares.map((s) => [s.participantId, s.amount]));

describe("worked example: 5 friends, host Alex pays, Sarah skipped the drinks", () => {
  const everyone = ["alex", "sarah", "ben", "chloe", "dan"];
  const drinkers = ["alex", "ben", "chloe", "dan"];
  const input: SplitInput = {
    participants: everyone,
    charges: SG_STANDARD_CHARGES,
    items: [
      { label: "Sharing platter", price: 5890, sharedBy: everyone },
      { label: "Truffle pasta", price: 1853, sharedBy: everyone },
      { label: "Margherita pizza", price: 1500, sharedBy: everyone },
      { label: "Drinks ×4", price: 2600, sharedBy: drinkers },
    ],
  };
  const result = splitReceipt(input);

  it("prints the receipt lines with 10% SC then 9% GST on (subtotal + SC)", () => {
    expect(result.totals).toEqual({ subtotal: 11843, serviceCharge: 1184, gst: 1172, total: 14199 });
  });

  it("allocates the total in proportion to each person's pre-charge subtotal", () => {
    // Food 92.43 / 5 = 18.486 each; drinkers add 26.00 / 4 = 6.50.
    // Exact shares: Sarah 141.99 × 18.486 / 118.43 = 22.1635..., others 29.9566...
    // Floors sum to 141.96; the 3 leftover cents go to the largest fractions
    // (the four drinkers tie at .9566, so by participant order: Alex, Ben, Chloe).
    expect(result.shares).toEqual([
      { participantId: "alex", amount: 2996, itemsSubtotal: 2499, paysNothing: false },
      { participantId: "sarah", amount: 2216, itemsSubtotal: 1849, paysNothing: false },
      { participantId: "ben", amount: 2996, itemsSubtotal: 2499, paysNothing: false },
      { participantId: "chloe", amount: 2996, itemsSubtotal: 2499, paysNothing: false },
      { participantId: "dan", amount: 2995, itemsSubtotal: 2499, paysNothing: false },
    ]);
  });

  it("shares sum exactly to the receipt total", () => {
    expect(result.shares.reduce((sum, share) => sum + share.amount, 0)).toBe(result.totals.total);
  });

  it("Sarah pays less than every drinker", () => {
    const sarah = result.shares.find((s) => s.participantId === "sarah")!;
    for (const share of result.shares) {
      if (share.participantId !== "sarah") expect(share.amount).toBeGreaterThan(sarah.amount);
    }
  });
});

describe("splitReceipt table", () => {
  const cases: ReadonlyArray<[string, SplitInput, Record<string, number>]> = [
    [
      "single payer gets the whole total",
      { charges: SG_STANDARD_CHARGES, items: [{ price: 10000, sharedBy: ["a"] }] },
      { a: 11990 },
    ],
    [
      "$0.10 split 3 ways with no charges: 4/3/3",
      { charges: NO_CHARGES, items: [{ price: 10, sharedBy: ["a", "b", "c"] }] },
      { a: 4, b: 3, c: 3 },
    ],
    [
      "$0.01 split 2 ways: first participant pays it",
      { charges: NO_CHARGES, items: [{ price: 1, sharedBy: ["a", "b"] }] },
      { a: 1, b: 0 },
    ],
    [
      "$0.01 split 5 ways",
      { charges: NO_CHARGES, items: [{ price: 1, sharedBy: ["a", "b", "c", "d", "e"] }] },
      { a: 1, b: 0, c: 0, d: 0, e: 0 },
    ],
    [
      "$0.02 split 3 ways",
      { charges: NO_CHARGES, items: [{ price: 2, sharedBy: ["a", "b", "c"] }] },
      { a: 1, b: 1, c: 0 },
    ],
    [
      "$1.00 split 3 ways",
      { charges: NO_CHARGES, items: [{ price: 100, sharedBy: ["a", "b", "c"] }] },
      { a: 34, b: 33, c: 33 },
    ],
    [
      "odd cents with SC + GST still sum to the printed total",
      { charges: SG_STANDARD_CHARGES, items: [{ price: 999, sharedBy: ["a", "b", "c"] }] },
      // 999 -> SC 100 -> GST 99 -> 1198; 1198 / 3 = 399.33...
      { a: 400, b: 399, c: 399 },
    ],
    [
      "participant order from `participants` wins tie-breaks",
      { charges: NO_CHARGES, participants: ["c", "b", "a"], items: [{ price: 10, sharedBy: ["a", "b", "c"] }] },
      { c: 4, b: 3, a: 3 },
    ],
    [
      "someone who ordered nothing owes nothing",
      { charges: SG_STANDARD_CHARGES, participants: ["a", "b"], items: [{ price: 1000, sharedBy: ["a"] }] },
      { a: 1199, b: 0 },
    ],
    [
      "custom weights 2:1",
      { charges: NO_CHARGES, items: [{ price: 300, sharedBy: ["a", "b"], weights: { a: 2, b: 1 } }] },
      { a: 200, b: 100 },
    ],
    [
      "custom weights with rounding: 3:1 on $0.10",
      { charges: NO_CHARGES, items: [{ price: 10, sharedBy: ["a", "b"], weights: { a: 3, b: 1 } }] },
      // exact 7.5 / 2.5 -> floors 7 / 2, leftover 1 goes to the larger fraction (tie -> a)
      { a: 8, b: 2 },
    ],
    [
      "different items shared by different subsets",
      {
        charges: SG_GST_ONLY,
        items: [
          { price: 1000, sharedBy: ["a", "b"] },
          { price: 500, sharedBy: ["b"] },
        ],
      },
      // subtotals a=500, b=1000; total 1635 -> a 545, b 1090
      { a: 545, b: 1090 },
    ],
    [
      "excluded birthday person pays nothing; the others absorb proportionally",
      {
        charges: NO_CHARGES,
        exclusion: { participants: ["bday"], redistribute: "proportional" },
        items: [
          { price: 3000, sharedBy: ["a", "b", "bday"] },
          { price: 1000, sharedBy: ["a"] },
        ],
      },
      // a subtotal 2000, b 1000, bday 1000 (dropped). 4000 × 2/3 = 2666.67, × 1/3 = 1333.33
      { a: 2667, b: 1333, bday: 0 },
    ],
    [
      "excluded person who is only in `exclusion`, not on any item",
      { charges: NO_CHARGES, exclusion: { participants: ["x"], redistribute: "proportional" }, items: [{ price: 100, sharedBy: ["a", "b"] }] },
      { a: 50, b: 50, x: 0 },
    ],
    [
      "birthday exclusion, redistribute proportional: $40 / $10 payers absorb $30 as 4:1",
      {
        charges: NO_CHARGES,
        exclusion: { participants: ["bday"], redistribute: "proportional" },
        items: [
          { price: 4000, sharedBy: ["a"] },
          { price: 1000, sharedBy: ["b"] },
          { price: 3000, sharedBy: ["bday"] },
        ],
      },
      // 8000 × 40/50 = 6400, × 10/50 = 1600
      { a: 6400, b: 1600, bday: 0 },
    ],
    [
      "birthday exclusion, redistribute equal: $40 / $10 payers each absorb $15",
      {
        charges: NO_CHARGES,
        exclusion: { participants: ["bday"], redistribute: "equal" },
        items: [
          { price: 4000, sharedBy: ["a"] },
          { price: 1000, sharedBy: ["b"] },
          { price: 3000, sharedBy: ["bday"] },
        ],
      },
      { a: 5500, b: 2500, bday: 0 },
    ],
    [
      "redistribute equal with charges: shares still sum to the printed total",
      {
        charges: SG_STANDARD_CHARGES,
        exclusion: { participants: ["bday"], redistribute: "equal" },
        items: [
          { price: 4000, sharedBy: ["a"] },
          { price: 1000, sharedBy: ["b"] },
          { price: 3000, sharedBy: ["bday"] },
        ],
      },
      // subtotal 8000, SC 800, GST 792, total 9592; weights 55:25 -> 6594.5 / 2997.5, largest remainder tie -> a
      { a: 6595, b: 2997, bday: 0 },
    ],
    [
      "only the excluded person ordered, redistribute equal: payers split equally",
      {
        charges: NO_CHARGES,
        participants: ["a", "b", "bday"],
        exclusion: { participants: ["bday"], redistribute: "equal" },
        items: [{ price: 101, sharedBy: ["bday"] }],
      },
      { a: 51, b: 50, bday: 0 },
    ],
    [
      "only the excluded person ordered: payers split equally",
      {
        charges: NO_CHARGES,
        participants: ["a", "b", "bday"],
        exclusion: { participants: ["bday"], redistribute: "proportional" },
        items: [{ price: 101, sharedBy: ["bday"] }],
      },
      { a: 51, b: 50, bday: 0 },
    ],
    [
      "treat: one participant pays everything",
      {
        charges: SG_STANDARD_CHARGES,
        treatedBy: "host",
        items: [
          { price: 2000, sharedBy: ["a", "b"] },
          { price: 1000, sharedBy: ["host"] },
        ],
      },
      { a: 0, b: 0, host: 3597 },
    ],
    [
      "treat by someone who ordered nothing",
      { charges: NO_CHARGES, treatedBy: "boss", items: [{ price: 2000, sharedBy: ["a", "b"] }] },
      { a: 0, b: 0, boss: 2000 },
    ],
    [
      "treat with an excluded participant present",
      { charges: NO_CHARGES, treatedBy: "host", exclusion: { participants: ["bday"], redistribute: "proportional" }, items: [{ price: 2000, sharedBy: ["a", "bday"] }] },
      { a: 0, bday: 0, host: 2000 },
    ],
    ["no items at all", { charges: SG_STANDARD_CHARGES, participants: ["a", "b"], items: [] }, { a: 0, b: 0 }],
    [
      "free item",
      { charges: SG_STANDARD_CHARGES, items: [{ price: 0, sharedBy: ["a", "b"] }] },
      { a: 0, b: 0 },
    ],
    [
      "excluded-only receipt with zero total",
      { charges: NO_CHARGES, exclusion: { participants: ["a"], redistribute: "proportional" }, items: [{ price: 0, sharedBy: ["a"] }] },
      { a: 0 },
    ],
  ];

  it.each(cases)("%s", (_name, input, expected) => {
    expect(amountsOf(input)).toEqual(expected);
    expect(sumShares(input)).toBe(splitReceipt(input).totals.total);
  });

  it("flags who pays nothing", () => {
    const excluded = splitReceipt({ charges: NO_CHARGES, exclusion: { participants: ["b"], redistribute: "proportional" }, items: [{ price: 10, sharedBy: ["a", "b"] }] });
    expect(excluded.shares.map((s) => s.paysNothing)).toEqual([false, true]);
    const treated = splitReceipt({ charges: NO_CHARGES, treatedBy: "a", items: [{ price: 10, sharedBy: ["a", "b"] }] });
    expect(treated.shares.map((s) => s.paysNothing)).toEqual([false, true]);
  });

  it("reports each participant's pre-charge item subtotal for display", () => {
    const result = splitReceipt({
      charges: SG_STANDARD_CHARGES,
      items: [
        { price: 1000, sharedBy: ["a", "b", "c"] },
        { price: 500, sharedBy: ["a"] },
      ],
    });
    // a = 333.33 + 500 -> 833; b = c = 333.33 -> 333
    expect(result.shares.map((s) => s.itemsSubtotal)).toEqual([833, 333, 333]);
  });

  it("uses a custom remainder policy when provided and still verifies the sum", () => {
    const lastGetsAll: RemainderPolicy = (leftover, candidates) =>
      candidates.map((_c, i) => (i === candidates.length - 1 ? leftover : 0));
    const result = splitReceipt({
      charges: NO_CHARGES,
      items: [{ price: 10, sharedBy: ["a", "b", "c"] }],
      remainderPolicy: lastGetsAll,
    });
    expect(result.shares.map((s) => s.amount)).toEqual([3, 3, 4]);

    const broken: RemainderPolicy = (_leftover, candidates) => candidates.map(() => 0);
    expect(() =>
      splitReceipt({ charges: NO_CHARGES, items: [{ price: 10, sharedBy: ["a", "b", "c"] }], remainderPolicy: broken }),
    ).toThrow(/shares sum to 9 but the total is 10/);
  });
});

describe("exclusion.redistribute is required", () => {
  it("is a compile-time error to omit redistribute", () => {
    const input: SplitInput = {
      charges: NO_CHARGES,
      items: [{ price: 100, sharedBy: ["a", "b"] }],
      // @ts-expect-error -- redistribute has no default and must be chosen explicitly
      exclusion: { participants: ["a"] },
    };
    expect(() => splitReceipt(input)).toThrow(SplitError);
  });

  it("proportional and equal modes differ when payers ordered unequal amounts", () => {
    const items: LineItem[] = [
      { price: 4000, sharedBy: ["a"] },
      { price: 1000, sharedBy: ["b"] },
      { price: 3000, sharedBy: ["bday"] },
    ];
    const proportional = amountsOf({ charges: NO_CHARGES, items, exclusion: { participants: ["bday"], redistribute: "proportional" } });
    const equal = amountsOf({ charges: NO_CHARGES, items, exclusion: { participants: ["bday"], redistribute: "equal" } });
    expect(proportional).toEqual({ a: 6400, b: 1600, bday: 0 });
    expect(equal).toEqual({ a: 5500, b: 2500, bday: 0 });
    expect(proportional).not.toEqual(equal);
  });
});

describe("splitReceipt validation", () => {
  const base = (items: LineItem[], extra: Partial<SplitInput> = {}): SplitInput => ({
    charges: NO_CHARGES,
    items,
    ...extra,
  });

  it.each([
    ["float price", base([{ price: 12.34, sharedBy: ["a"] }]), MoneyError],
    ["negative price", base([{ price: -1, sharedBy: ["a"] }]), MoneyError],
    ["unsafe integer price", base([{ price: 2 ** 53, sharedBy: ["a"] }]), MoneyError],
    ["NaN price", base([{ price: NaN, sharedBy: ["a"] }]), MoneyError],
    ["string price", base([{ price: "100" as unknown as number, sharedBy: ["a"] }]), MoneyError],
    ["empty sharedBy", base([{ price: 100, sharedBy: [] }]), SplitError],
    ["duplicate sharer", base([{ price: 100, sharedBy: ["a", "a"] }]), SplitError],
    ["empty participant id", base([{ price: 100, sharedBy: [""] }]), SplitError],
    ["missing weight", base([{ price: 100, sharedBy: ["a", "b"], weights: { a: 1 } }]), SplitError],
    ["zero weight", base([{ price: 100, sharedBy: ["a", "b"], weights: { a: 0, b: 1 } }]), SplitError],
    ["negative weight", base([{ price: 100, sharedBy: ["a", "b"], weights: { a: -1, b: 1 } }]), SplitError],
    ["float weight", base([{ price: 100, sharedBy: ["a", "b"], weights: { a: 1.5, b: 1 } }]), SplitError],
    [
      "participant referenced but not declared",
      base([{ price: 100, sharedBy: ["a", "b"] }], { participants: ["a"] }),
      SplitError,
    ],
    ["duplicate in participants", base([{ price: 100, sharedBy: ["a"] }], { participants: ["a", "a"] }), SplitError],
    ["treating and excluded", base([{ price: 100, sharedBy: ["a"] }], { treatedBy: "a", exclusion: { participants: ["a"], redistribute: "proportional" } }), SplitError],
    ["everyone excluded with a non-zero total", base([{ price: 100, sharedBy: ["a"] }], { exclusion: { participants: ["a"], redistribute: "proportional" } }), SplitError],
    [
      "unknown exclusion.redistribute mode",
      base([{ price: 100, sharedBy: ["a", "b"] }], {
        exclusion: { participants: ["a"], redistribute: "halvsies" as unknown as "equal" },
      }),
      SplitError,
    ],
    [
      "exclusion without redistribute",
      base([{ price: 100, sharedBy: ["a", "b"] }], {
        exclusion: { participants: ["a"] } as unknown as SplitInput["exclusion"],
      }),
      SplitError,
    ],
    [
      "duplicate in exclusion.participants",
      base([{ price: 100, sharedBy: ["a", "b"] }], { exclusion: { participants: ["a", "a"], redistribute: "proportional" } }),
      SplitError,
    ],
    ["float service charge rate", base([{ price: 100, sharedBy: ["a"] }], { charges: { serviceChargeBps: 0.1, gstBps: 0 } }), MoneyError],
  ])("rejects %s", (_name, input, errorType) => {
    expect(() => splitReceipt(input)).toThrow(errorType);
  });
});

describe("property: shares always sum to the receipt total", () => {
  const participantIds = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];

  const lineItemArb = fc.record({
    price: fc.integer({ min: 0, max: 50_000_00 }),
    sharedBy: fc.uniqueArray(fc.constantFrom(...participantIds), { minLength: 1, maxLength: participantIds.length }),
    weights: fc.option(fc.array(fc.integer({ min: 1, max: 7 }), { minLength: participantIds.length, maxLength: participantIds.length }), {
      nil: undefined,
    }),
  }).map(({ price, sharedBy, weights }): LineItem => ({
    price,
    sharedBy,
    weights: weights === undefined ? undefined : Object.fromEntries(sharedBy.map((id) => [id, weights[participantIds.indexOf(id)]])),
  }));

  const chargesArb: fc.Arbitrary<ChargePolicy> = fc.oneof(
    fc.constant(SG_STANDARD_CHARGES),
    fc.constant(SG_GST_ONLY),
    fc.constant(NO_CHARGES),
    fc.record({ serviceChargeBps: fc.integer({ min: 0, max: 2500 }), gstBps: fc.integer({ min: 0, max: 2500 }) }),
  );

  const inputArb: fc.Arbitrary<SplitInput> = fc
    .record({
      items: fc.array(lineItemArb, { minLength: 1, maxLength: 12 }),
      charges: chargesArb,
      exclusion: fc.option(
        fc.record({
          participants: fc.uniqueArray(fc.constantFrom(...participantIds), { maxLength: 2 }),
          redistribute: fc.constantFrom<ExclusionRedistribution>("proportional", "equal"),
        }),
        { nil: undefined },
      ),
      treatedBy: fc.option(fc.constantFrom(...participantIds), { nil: undefined }),
    })
    .map(({ items, charges, exclusion, treatedBy }): SplitInput => ({
      items,
      charges,
      participants: participantIds,
      exclusion:
        exclusion === undefined
          ? undefined
          : { ...exclusion, participants: exclusion.participants.filter((id) => id !== treatedBy) },
      treatedBy,
    }));

  it("sum(shares) === totals.total, nobody negative, non-payers owe 0", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = splitReceipt(input);
        const sum = result.shares.reduce((acc, share) => acc + share.amount, 0);
        expect(sum).toBe(result.totals.total);
        expect(result.totals.total).toBe(result.totals.subtotal + result.totals.serviceCharge + result.totals.gst);
        for (const share of result.shares) {
          expect(Number.isSafeInteger(share.amount)).toBe(true);
          expect(share.amount).toBeGreaterThanOrEqual(0);
          if (share.paysNothing) expect(share.amount).toBe(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("each share is within one cent of its exact proportional value", () => {
    fc.assert(
      fc.property(inputArb.filter((i) => i.treatedBy === undefined && i.exclusion === undefined), (input) => {
        const result = splitReceipt(input);
        const subtotal = result.totals.subtotal;
        if (subtotal === 0) return;
        // Cross-check against an independent bigint computation of floor(total × itemCents / subtotal)
        // using the unrounded per-item shares; shares differ from the exact value by < 1 cent.
        const exact = new Map<string, bigint>();
        const scale = BigInt(1_000_000);
        for (const item of input.items) {
          const weightOf = (id: string) => BigInt(item.weights?.[id] ?? 1);
          const totalWeight = item.sharedBy.reduce((acc, id) => acc + weightOf(id), BigInt(0));
          for (const id of item.sharedBy) {
            const scaled = (BigInt(item.price) * weightOf(id) * scale) / totalWeight;
            exact.set(id, (exact.get(id) ?? BigInt(0)) + scaled);
          }
        }
        for (const share of result.shares) {
          const scaledShare = ((exact.get(share.participantId) ?? BigInt(0)) * BigInt(result.totals.total)) / BigInt(subtotal);
          const lower = Number(scaledShare / scale);
          expect(share.amount).toBeGreaterThanOrEqual(lower - 1);
          expect(share.amount).toBeLessThanOrEqual(lower + 2);
        }
      }),
      { numRuns: 300 },
    );
  });
});
