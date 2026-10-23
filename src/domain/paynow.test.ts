import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MoneyError } from "./money";
import {
  assertReference,
  buildPayNowPayload,
  crc16CcittFalse,
  encodeTlv,
  formatAmount,
  MAX_PAYNOW_CENTS,
  normaliseSgMobile,
  normaliseUen,
  parseTlv,
  PAYNOW_ACCOUNT_FIELD,
  PAYNOW_ADDITIONAL_FIELD,
  PAYNOW_FIELD,
  PayNowError,
  sanitisePayeeName,
  verifyPayNowCrc,
} from "./paynow";

const fieldMap = (tlv: string) => Object.fromEntries(parseTlv(tlv).map((f) => [f.id, f.value]));

describe("crc16CcittFalse", () => {
  it("matches the CRC-16/CCITT-FALSE check vector", () => {
    expect(crc16CcittFalse("123456789")).toBe("29B1");
  });

  it("returns the init value for the empty string and pads to 4 hex chars", () => {
    expect(crc16CcittFalse("")).toBe("FFFF");
    expect(crc16CcittFalse("A")).toBe("B915");
    expect(crc16CcittFalse("A")).toMatch(/^[0-9A-F]{4}$/);
  });

  it("rejects non-ASCII input", () => {
    expect(() => crc16CcittFalse("café")).toThrow(PayNowError);
  });

  it("always yields 4 uppercase hex characters (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))) }), (s) => {
        expect(crc16CcittFalse(s)).toMatch(/^[0-9A-F]{4}$/);
      }),
    );
  });
});

describe("encodeTlv / parseTlv", () => {
  it("encodes id, zero-padded 2-digit length, value", () => {
    expect(encodeTlv("00", "01")).toBe("000201");
    expect(encodeTlv("59", "Alex Tan")).toBe("5908Alex Tan");
    expect(encodeTlv("26", "x".repeat(99))).toBe(`2699${"x".repeat(99)}`);
    expect(encodeTlv("54", "0.01")).toBe("54040.01");
  });

  it("rejects bad ids, empty values and values over 99 characters", () => {
    expect(() => encodeTlv("0", "x")).toThrow(PayNowError);
    expect(() => encodeTlv("ab", "x")).toThrow(PayNowError);
    expect(() => encodeTlv("00", "")).toThrow(PayNowError);
    expect(() => encodeTlv("00", "x".repeat(100))).toThrow(PayNowError);
  });

  it("parses a flat sequence back in order", () => {
    expect(parseTlv("000201010212")).toEqual([
      { id: "00", value: "01" },
      { id: "01", value: "12" },
    ]);
    expect(parseTlv("")).toEqual([]);
  });

  it("rejects truncated or malformed data", () => {
    expect(() => parseTlv("0002")).toThrow(PayNowError);
    expect(() => parseTlv("00020")).toThrow(PayNowError);
    expect(() => parseTlv("0A0201")).toThrow(PayNowError);
    expect(() => parseTlv("00x201")).toThrow(PayNowError);
    expect(() => parseTlv("000201X")).toThrow(PayNowError);
  });

  it("round-trips arbitrary printable values (property)", () => {
    const printable = fc.string({
      unit: fc.constantFrom(...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))),
      minLength: 1,
      maxLength: 99,
    });
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 99 }), printable), { maxLength: 10 }), (fields) => {
        const encoded = fields.map(([id, value]) => encodeTlv(String(id).padStart(2, "0"), value)).join("");
        expect(parseTlv(encoded)).toEqual(fields.map(([id, value]) => ({ id: String(id).padStart(2, "0"), value })));
      }),
    );
  });
});

describe("formatAmount", () => {
  it.each([
    [1, "0.01"],
    [10, "0.10"],
    [100, "1.00"],
    [1234, "12.34"],
    [2216, "22.16"],
    [100000, "1000.00"],
    [123456789, "1234567.89"],
    [MAX_PAYNOW_CENTS, "9999999.99"],
  ])("%i cents -> %s", (cents, expected) => {
    expect(formatAmount(cents)).toBe(expected);
  });

  it("rejects zero, negatives, non-integers and amounts above the PayNow maximum", () => {
    expect(() => formatAmount(0)).toThrow(PayNowError);
    expect(() => formatAmount(-1)).toThrow(PayNowError);
    expect(() => formatAmount(MAX_PAYNOW_CENTS + 1)).toThrow(PayNowError);
    expect(() => formatAmount(12.34)).toThrow(MoneyError);
    expect(() => formatAmount(Number.NaN)).toThrow(MoneyError);
  });

  it("always has exactly two decimals and no grouping (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_PAYNOW_CENTS }), (cents) => {
        const text = formatAmount(cents);
        expect(text).toMatch(/^\d+\.\d{2}$/);
        const [whole, fraction] = text.split(".");
        expect(Number(whole) * 100 + Number(fraction)).toBe(cents);
      }),
    );
  });
});

describe("normaliseSgMobile", () => {
  it.each([
    ["91234567", "+6591234567"],
    ["9123 4567", "+6591234567"],
    ["9123-4567", "+6591234567"],
    ["+6591234567", "+6591234567"],
    ["+65 9123 4567", "+6591234567"],
    ["6591234567", "+6591234567"],
    ["65 8123 4567", "+6581234567"],
    ["(65) 8123.4567", "+6581234567"],
    ["81234567", "+6581234567"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseSgMobile(input)).toBe(expected);
  });

  it.each(["", "1234567", "912345678", "61234567", "71234567", "+6061234567", "+44 7911 123456", "9123456a", "+6591234567x"])(
    "rejects %j",
    (input) => {
      expect(() => normaliseSgMobile(input)).toThrow(PayNowError);
    },
  );
});

describe("normaliseUen", () => {
  it.each([
    ["201234567A", "201234567A"],
    ["53012345A", "53012345A"],
    ["T08GB0001A", "T08GB0001A"],
    ["t08gb0001a", "T08GB0001A"],
    [" 12345678 ", "12345678"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseUen(input)).toBe(expected);
  });

  it.each(["", "1234567", "12345678901", "2012-34567A", "2012 34567", "T08GB0001A001"])("rejects %j", (input) => {
    expect(() => normaliseUen(input)).toThrow(PayNowError);
  });
});

describe("sanitisePayeeName", () => {
  it("strips accents, drops other non-ASCII, collapses whitespace and cuts to 25 characters", () => {
    expect(sanitisePayeeName("Alex Tan")).toBe("Alex Tan");
    expect(sanitisePayeeName("  Zoë   Müller ")).toBe("Zoe Muller");
    expect(sanitisePayeeName("陈小明 Alex")).toBe("Alex");
    expect(sanitisePayeeName("Alex 🎉 Tan")).toBe("Alex Tan");
    expect(sanitisePayeeName("Alexander Benedict Tan Wei Ming")).toBe("Alexander Benedict Tan We");
    expect(sanitisePayeeName("Alexander Benedict Tan Wei Ming")).toHaveLength(25);
    expect(sanitisePayeeName("Alexander Benedicts Tann  Wei")).toBe("Alexander Benedicts Tann");
  });

  it("rejects names with nothing printable left", () => {
    expect(() => sanitisePayeeName("陈小明")).toThrow(PayNowError);
    expect(() => sanitisePayeeName("   ")).toThrow(PayNowError);
  });
});

describe("assertReference", () => {
  it("accepts 1-25 alphanumeric characters", () => {
    expect(assertReference("SL7K2M9Q")).toBe("SL7K2M9Q");
    expect(assertReference("a")).toBe("a");
    expect(assertReference("A".repeat(25))).toBe("A".repeat(25));
  });

  it.each(["", "A".repeat(26), "SL-7K2M9Q", "SL 7K", "ref#1", "réf"])("rejects %j", (input) => {
    expect(() => assertReference(input)).toThrow(PayNowError);
  });
});

describe("buildPayNowPayload", () => {
  const sarahShare = {
    proxyType: "mobile" as const,
    proxyValue: "9123 4567",
    amount: 2216,
    reference: "SL7K2M9Q",
    payeeName: "Alex Tan",
  };

  it("produces the golden mobile payload (CRC computed independently)", () => {
    expect(buildPayNowPayload(sarahShare)).toBe(
      "00020101021226380009SG.PAYNOW010100211+659123456703010" +
        "520400005303702540522.165802SG5908Alex Tan6009Singapore62120108SL7K2M9Q6304868D",
    );
  });

  it("decodes back field by field, in SGQR order", () => {
    const payload = buildPayNowPayload(sarahShare);
    const fields = parseTlv(payload);
    expect(fields.map((f) => f.id)).toEqual(["00", "01", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
    const top = fieldMap(payload);
    expect(top[PAYNOW_FIELD.payloadFormat]).toBe("01");
    expect(top[PAYNOW_FIELD.pointOfInitiation]).toBe("12");
    expect(top[PAYNOW_FIELD.merchantCategory]).toBe("0000");
    expect(top[PAYNOW_FIELD.currency]).toBe("702");
    expect(top[PAYNOW_FIELD.amount]).toBe("22.16");
    expect(top[PAYNOW_FIELD.country]).toBe("SG");
    expect(top[PAYNOW_FIELD.payeeName]).toBe("Alex Tan");
    expect(top[PAYNOW_FIELD.city]).toBe("Singapore");
    expect(top[PAYNOW_FIELD.crc]).toBe("868D");

    const account = parseTlv(top[PAYNOW_FIELD.merchantAccount]);
    expect(account.map((f) => f.id)).toEqual(["00", "01", "02", "03"]);
    const accountMap = fieldMap(top[PAYNOW_FIELD.merchantAccount]);
    expect(accountMap[PAYNOW_ACCOUNT_FIELD.scheme]).toBe("SG.PAYNOW");
    expect(accountMap[PAYNOW_ACCOUNT_FIELD.proxyType]).toBe("0");
    expect(accountMap[PAYNOW_ACCOUNT_FIELD.proxyValue]).toBe("+6591234567");
    expect(accountMap[PAYNOW_ACCOUNT_FIELD.editable]).toBe("0");
    expect(accountMap[PAYNOW_ACCOUNT_FIELD.expiry]).toBeUndefined();

    expect(fieldMap(top[PAYNOW_FIELD.additionalData])).toEqual({ [PAYNOW_ADDITIONAL_FIELD.billNumber]: "SL7K2M9Q" });
  });

  it("CRC covers everything before it including the literal 6304", () => {
    const payload = buildPayNowPayload(sarahShare);
    const body = payload.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(crc16CcittFalse(body)).toBe(payload.slice(-4));
    expect(verifyPayNowCrc(payload)).toBe(true);
    expect(verifyPayNowCrc(payload.slice(0, -1) + (payload.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(verifyPayNowCrc(payload.replace("22.16", "22.17"))).toBe(false);
    expect(verifyPayNowCrc("")).toBe(false);
    expect(verifyPayNowCrc("000201")).toBe(false);
  });

  it("encodes a UEN payee with an expiry date in Singapore time", () => {
    const payload = buildPayNowPayload({
      proxyType: "uen",
      proxyValue: "t08gb0001a",
      amount: 123456789,
      reference: "INV2026000123",
      payeeName: "Zoë's Café Pte Ltd",
      // 2026-12-31T16:00Z is already 1 Jan 2027 in Singapore.
      expiry: new Date("2026-12-31T16:00:00Z"),
    });
    const top = fieldMap(payload);
    const account = fieldMap(top[PAYNOW_FIELD.merchantAccount]);
    expect(parseTlv(top[PAYNOW_FIELD.merchantAccount]).map((f) => f.id)).toEqual(["00", "01", "02", "03", "04"]);
    expect(account).toEqual({ "00": "SG.PAYNOW", "01": "2", "02": "T08GB0001A", "03": "0", "04": "20270101" });
    expect(top[PAYNOW_FIELD.amount]).toBe("1234567.89");
    expect(top[PAYNOW_FIELD.payeeName]).toBe("Zoe's Cafe Pte Ltd");
    expect(fieldMap(top[PAYNOW_FIELD.additionalData])["01"]).toBe("INV2026000123");
    expect(verifyPayNowCrc(payload)).toBe(true);
  });

  it("never emits anything but printable ASCII", () => {
    const payload = buildPayNowPayload({ ...sarahShare, payeeName: "陈小明 Alex 🎉" });
    expect(payload).toMatch(/^[\x20-\x7e]+$/);
  });

  it("rejects invalid input with a PayNowError", () => {
    expect(() => buildPayNowPayload({ ...sarahShare, amount: 0 })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, amount: MAX_PAYNOW_CENTS + 1 })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, amount: 22.16 })).toThrow(MoneyError);
    expect(() => buildPayNowPayload({ ...sarahShare, proxyValue: "1234" })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, proxyType: "uen", proxyValue: "9123 4567" })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, proxyType: "email" as never })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, reference: "SL-7K" })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, reference: "A".repeat(26) })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, payeeName: "陈小明" })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, editable: true as never })).toThrow(PayNowError);
    expect(() => buildPayNowPayload({ ...sarahShare, expiry: new Date("nope") })).toThrow(RangeError);
  });

  it("round-trips any valid share (property)", () => {
    const alnum = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_PAYNOW_CENTS }),
        fc.integer({ min: 80_000_000, max: 99_999_999 }),
        fc.string({ unit: alnum, minLength: 1, maxLength: 25 }),
        fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz '-".split("")), minLength: 1, maxLength: 40 }).filter(
          (s) => s.trim().length > 0,
        ),
        (amount, mobile, reference, payeeName) => {
          const payload = buildPayNowPayload({ proxyType: "mobile", proxyValue: String(mobile), amount, reference, payeeName });
          expect(verifyPayNowCrc(payload)).toBe(true);
          const top = fieldMap(payload);
          expect(top["54"]).toBe(formatAmount(amount));
          expect(fieldMap(top["26"])["02"]).toBe(`+65${mobile}`);
          expect(fieldMap(top["62"])["01"]).toBe(reference);
          expect(top["59"]).toBe(sanitisePayeeName(payeeName));
          expect(top["59"].length).toBeLessThanOrEqual(25);
        },
      ),
    );
  });
});
