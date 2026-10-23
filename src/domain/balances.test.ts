import { describe, expect, it } from "vitest";

import {
  allBalances,
  appendEvent,
  assertLedgerEvent,
  balanceOf,
  creditOf,
  outstandingRequest,
  signedAmount,
  type Ledger,
  type LedgerEvent,
} from "./balances";
import { MoneyError } from "./money";

const ev = (type: LedgerEvent["type"], amount: number, friendId = "sarah"): LedgerEvent => ({ type, friendId, amount });

describe("balanceOf / outstandingRequest / creditOf", () => {
  const cases: ReadonlyArray<[string, Ledger, number, number, number]> = [
    // name, ledger, balance, outstanding, credit
    ["empty ledger", [], 0, 0, 0],
    ["one share", [ev("expense_share", 2216)], 2216, 2216, 0],
    ["share fully paid", [ev("expense_share", 2216), ev("payment", 2216)], 0, 0, 0],
    ["share partly paid", [ev("expense_share", 2216), ev("payment", 2000)], 216, 216, 0],
    ["overpayment becomes credit", [ev("expense_share", 2000), ev("payment", 2500)], -500, 0, 500],
    ["$20 credit from last month, then $22.16 share", [ev("credit", 2000), ev("expense_share", 2216)], 216, 216, 2000 - 2000],
    ["credit larger than the share: nothing to ask, credit remains", [ev("credit", 5000), ev("expense_share", 2216)], -2784, 0, 2784],
    ["credit is consumed across several shares", [ev("credit", 2000), ev("expense_share", 1500), ev("expense_share", 1500)], 1000, 1000, 0],
    ["friend fronted the host", [ev("expense_share", 3000), ev("friend_fronted", 4500)], -1500, 0, 1500],
    ["friend fronted exactly offsets", [ev("expense_share", 3000), ev("friend_fronted", 3000)], 0, 0, 0],
    ["pure credit, never asked for a negative amount", [ev("credit", 100)], -100, 0, 100],
    ["mixed history", [ev("expense_share", 1000), ev("payment", 400), ev("friend_fronted", 100), ev("expense_share", 250), ev("credit", 50)], 700, 700, 0],
    ["other friends' events are ignored", [ev("expense_share", 999, "ben"), ev("expense_share", 10), ev("payment", 5, "ben")], 10, 10, 0],
    ["zero amounts are allowed and neutral", [ev("expense_share", 0), ev("payment", 0)], 0, 0, 0],
  ];

  it.each(cases)("%s", (_name, ledger, balance, outstanding, credit) => {
    expect(balanceOf(ledger, "sarah")).toBe(balance);
    expect(outstandingRequest(ledger, "sarah")).toBe(outstanding);
    expect(creditOf(ledger, "sarah")).toBe(credit);
    expect(outstandingRequest(ledger, "sarah")).toBeGreaterThanOrEqual(0);
    expect(creditOf(ledger, "sarah")).toBeGreaterThanOrEqual(0);
  });

  it("outstandingRequest is share minus credit for the brief's example", () => {
    const ledger: Ledger = [ev("credit", 2000, "friend"), ev("expense_share", 3550, "friend")];
    expect(outstandingRequest(ledger, "friend")).toBe(3550 - 2000);
  });

  it("unknown friend has a zero balance", () => {
    expect(balanceOf([ev("expense_share", 100)], "nobody")).toBe(0);
    expect(outstandingRequest([ev("expense_share", 100)], "nobody")).toBe(0);
  });
});

describe("signedAmount", () => {
  it.each([
    ["expense_share", 100],
    ["payment", -100],
    ["credit", -100],
    ["friend_fronted", -100],
  ] as const)("%s -> %i", (type, expected) => {
    expect(signedAmount(ev(type, 100))).toBe(expected);
  });
});

describe("appendEvent / allBalances", () => {
  it("appendEvent returns a new validated ledger without mutating the input", () => {
    const original: Ledger = [ev("expense_share", 100)];
    const next = appendEvent(original, ev("payment", 40));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(balanceOf(next, "sarah")).toBe(60);
  });

  it("allBalances reports every friend in order of first appearance", () => {
    const ledger: Ledger = [
      ev("expense_share", 2996, "ben"),
      ev("expense_share", 2216, "sarah"),
      ev("payment", 1000, "ben"),
      ev("credit", 3000, "sarah"),
    ];
    expect([...allBalances(ledger)]).toEqual([
      ["ben", 1996],
      ["sarah", -784],
    ]);
  });
});

describe("ledger validation", () => {
  it.each([
    ["float amount", ev("payment", 12.5)],
    ["negative amount", ev("payment", -1)],
    ["unsafe amount", ev("expense_share", 2 ** 53)],
    ["NaN amount", ev("credit", NaN)],
    ["unknown type", { type: "refund" as LedgerEvent["type"], friendId: "sarah", amount: 1 }],
    ["empty friendId", ev("payment", 1, "")],
  ])("rejects %s", (_name, event) => {
    expect(() => assertLedgerEvent(event)).toThrow(MoneyError);
    expect(() => appendEvent([], event)).toThrow(MoneyError);
    expect(() => balanceOf([event], event.friendId)).toThrow(MoneyError);
  });

  it("rejects balances that leave the safe integer range", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(() => balanceOf([ev("expense_share", big), ev("expense_share", big)], "sarah")).toThrow(MoneyError);
    expect(() => allBalances([ev("expense_share", big), ev("expense_share", big)])).toThrow(MoneyError);
  });
});
