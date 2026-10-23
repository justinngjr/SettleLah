import { describe, expect, it } from "vitest";

import {
  DBS_FAST_MANUAL_FORWARD,
  DBS_HTML_ONLY,
  DBS_PAYNOW_AUTOFORWARD,
  DBS_UNKNOWN_FORMAT,
  GARBAGE,
  NON_BANK_SENDER,
  POSB_PAYNOW_NO_REFERENCE,
} from "../fixtures.test-helpers";
import { ParseError } from "../types";
import { dbsParser, parseAmountCents, parsePayerName, parseReference, parseSgtDate } from "./dbs";
import { findParser } from "./index";

describe("dbsParser", () => {
  it("parses the PayNow auto-forwarded alert", () => {
    expect(dbsParser.canParse(DBS_PAYNOW_AUTOFORWARD)).toBe(true);
    const alert = dbsParser.parse(DBS_PAYNOW_AUTOFORWARD);
    expect(alert).toEqual({
      amount: 2500,
      payerName: "ROBERT TAN",
      reference: "SLBBBBBB",
      receivedAt: new Date("2025-01-12T06:05:00Z"),
    });
  });

  it("parses a manually forwarded FAST alert (host in From, bank in the body)", () => {
    const alert = dbsParser.parse(DBS_FAST_MANUAL_FORWARD);
    expect(alert.amount).toBe(123450);
    expect(alert.payerName).toBe("TAN AH KOW");
    expect(alert.reference).toBe("20250203FAST000123");
    expect(alert.receivedAt).toEqual(new Date("2025-02-03T01:14:00Z"));
  });

  it("parses POSB wording with S$ and a 12-hour clock; '-' reference is null", () => {
    expect(dbsParser.canParse(POSB_PAYNOW_NO_REFERENCE)).toBe(true);
    const alert = dbsParser.parse(POSB_PAYNOW_NO_REFERENCE);
    expect(alert).toEqual({
      amount: 880,
      payerName: "LIM MEI CARA",
      reference: null,
      receivedAt: new Date("2025-03-05T15:42:00Z"),
    });
  });

  it("parses an HTML-only alert", () => {
    expect(dbsParser.canParse(DBS_HTML_ONLY)).toBe(true);
    const alert = dbsParser.parse(DBS_HTML_ONLY);
    expect(alert.amount).toBe(10000);
    expect(alert.payerName).toBe("DAN LEE");
    expect(alert.reference).toBe("SLDDDDDD");
    expect(alert.receivedAt).toEqual(new Date("2025-04-01T00:00:00Z"));
  });

  it("falls back to the Date header, then to now, when the body has no date", () => {
    const withHeader = { ...POSB_PAYNOW_NO_REFERENCE, text: "You have received S$8.80 via PayNow.\nFrom: LIM MEI CARA", headers: { date: "Wed, 05 Mar 2025 15:42:00 +0000" } };
    expect(dbsParser.parse(withHeader).receivedAt).toEqual(new Date("2025-03-05T15:42:00Z"));
    const before = Date.now();
    const noDate = dbsParser.parse({ ...withHeader, headers: undefined });
    expect(noDate.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("does not claim non-bank or unknown-format emails, and throws ParseError on garbage", () => {
    expect(dbsParser.canParse(NON_BANK_SENDER)).toBe(false);
    expect(findParser(NON_BANK_SENDER)).toBeNull();
    // Card transaction: mentions DBS but none of the transfer words.
    expect(dbsParser.canParse(DBS_UNKNOWN_FORMAT)).toBe(false);
    expect(dbsParser.canParse(GARBAGE)).toBe(true);
    expect(() => dbsParser.parse(GARBAGE)).toThrow(ParseError);
    expect(findParser(DBS_PAYNOW_AUTOFORWARD)).toBe(dbsParser);
  });
});

describe("field parsers", () => {
  it.each([
    ["You have received SGD 12.34", 1234],
    ["transfer of S$12.34 to", 1234],
    ["credited SGD1,234.50 from", 123450],
    ["Amount: $0.05", 5],
    ["received SGD 12.345", 1234],
    ["Account ending 1234. You have received SGD 7.00", 700],
    ["nothing here", null],
    ["SGD 0.00", null],
  ])("amount %j -> %j", (text, cents) => {
    expect(parseAmountCents(text)).toBe(cents);
  });

  it("prefers the amount in the 'received' sentence over an earlier one", () => {
    expect(parseAmountCents("Your balance is SGD 500.00. You have received SGD 25.00.")).toBe(2500);
  });

  it.each([
    ["Payer's Name: ROBERT TAN", "ROBERT TAN"],
    ["Payer Name : TAN AH KOW\nReference: x", "TAN AH KOW"],
    ["Sender's name: O'NEIL JOHN", "O'NEIL JOHN"],
    ["**From:** LIM MEI CARA", "LIM MEI CARA"],
    ["credited on 03/02/2025 09:14 from TAN AH KOW.", "TAN AH KOW"],
    ["transfer from ROBERT TAN to your account", "ROBERT TAN"],
    ["From: host@gmail.com", null],
    ["no name here", null],
  ])("payer %j -> %j", (text, name) => {
    expect(parsePayerName(text)).toBe(name);
  });

  it.each([
    ["Reference: SLBBBBBB", "SLBBBBBB"],
    ["Payer's Reference / Other info: SLBBBBBB", "SLBBBBBB"],
    ["Other Info: dinner slcccccc", "dinner slcccccc"],
    ["Transaction Ref: 20250203FAST000123", "20250203FAST000123"],
    ["Reference: -", null],
    ["Reference: NIL", null],
    ["Reference:", null],
    ["Remarks: thanks", "thanks"],
    ["no reference line", null],
  ])("reference %j -> %j", (text, reference) => {
    expect(parseReference(text)).toBe(reference);
  });

  it.each([
    ["12 Jan 2025 at 14:05", "2025-01-12T06:05:00Z"],
    ["12 January 2025, 2:05 pm", "2025-01-12T06:05:00Z"],
    ["05 Mar 2025, 12:10 AM", "2025-03-04T16:10:00Z"],
    ["03/02/2025 09:14", "2025-02-03T01:14:00Z"],
    ["2025-04-01 08:00:00", "2025-04-01T00:00:00Z"],
    ["2025-04-01", "2025-03-31T16:00:00Z"],
  ])("date %j -> %s", (text, iso) => {
    expect(parseSgtDate(text)).toEqual(new Date(iso));
  });

  it("returns null when no date is present", () => {
    expect(parseSgtDate("no date")).toBeNull();
  });
});
