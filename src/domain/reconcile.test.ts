import { describe, expect, it } from "vitest";

import {
  canAutoConfirm,
  isKnownBankName,
  matchBankAlert,
  normaliseBankName,
  referenceMatches,
  referenceTokens,
  type AlertForMatch,
  type FriendForMatch,
  type MatchProposal,
  type OpenRequestForMatch,
} from "./reconcile";

const bob: FriendForMatch = { id: "bob", knownBankNames: ["ROBERT TAN"] };
const cara: FriendForMatch = { id: "cara", knownBankNames: ["CARA LIM", "Lim Mei Cara"] };
const dan: FriendForMatch = { id: "dan", knownBankNames: [] };
const FRIENDS = [bob, cara, dan];

const req = (id: string, friendId: string, amount: number, reference: string): OpenRequestForMatch => ({
  id,
  friendId,
  amount,
  reference,
});

const alert = (amount: number, payerName: string | null = null, reference: string | null = null): AlertForMatch => ({
  amount,
  payerName,
  reference,
});

describe("normaliseBankName", () => {
  it("upper-cases, strips punctuation and collapses whitespace", () => {
    expect(normaliseBankName("  Tan  Ah-Kow ")).toBe("TAN AH KOW");
    expect(normaliseBankName("O'NEIL, JOHN")).toBe("O NEIL JOHN");
    expect(normaliseBankName("")).toBe("");
  });
});

describe("referenceTokens / referenceMatches", () => {
  it("splits on non-alphanumerics and matches whole tokens only", () => {
    expect(referenceTokens("slk7m2qx dinner")).toEqual(["SLK7M2QX", "DINNER"]);
    expect(referenceTokens(null)).toEqual([]);
    expect(referenceMatches("Other info: SLK7M2QX", "SLK7M2QX")).toBe(true);
    expect(referenceMatches("SLK7M2QX", "SLK7M2QX")).toBe(true);
    expect(referenceMatches("SLK7M2QXX", "SLK7M2QX")).toBe(false);
    expect(referenceMatches("", "SLK7M2QX")).toBe(false);
    expect(referenceMatches(null, "SLK7M2QX")).toBe(false);
  });
});

describe("isKnownBankName", () => {
  it("compares normalised names", () => {
    expect(isKnownBankName(cara, "lim mei cara")).toBe(true);
    expect(isKnownBankName(cara, "CARA  LIM")).toBe(true);
    expect(isKnownBankName(cara, "CARA")).toBe(false);
    expect(isKnownBankName(cara, null)).toBe(false);
    expect(isKnownBankName(dan, "ANYONE")).toBe(false);
  });
});

describe("matchBankAlert", () => {
  const requests = [
    req("r-bob", "bob", 2500, "SLBBBBBB"),
    req("r-cara", "cara", 1000, "SLCCCCCC"),
    req("r-dan", "dan", 1000, "SLDDDDDD"),
    req("r-dan2", "dan", 4200, "SLDDDDD2"),
  ];

  const cases: Array<{ name: string; alert: AlertForMatch; expected: MatchProposal }> = [
    {
      name: "(a) reference match is strong even when amount and name disagree",
      alert: alert(999, "SOMEONE ELSE", "SLBBBBBB"),
      expected: { kind: "proposed", friendId: "bob", paymentRequestId: "r-bob", confidence: "strong", reason: "reference" },
    },
    {
      name: "(a) reference embedded in free text",
      alert: alert(2500, null, "dinner SLBBBBBB thx"),
      expected: { kind: "proposed", friendId: "bob", paymentRequestId: "r-bob", confidence: "strong", reason: "reference" },
    },
    {
      name: "(a) lower-case reference still matches",
      alert: alert(2500, null, "slbbbbbb"),
      expected: { kind: "proposed", friendId: "bob", paymentRequestId: "r-bob", confidence: "strong", reason: "reference" },
    },
    {
      name: "(b) known name + amount beats the amount tie",
      alert: alert(1000, "CARA LIM", null),
      expected: {
        kind: "proposed",
        friendId: "cara",
        paymentRequestId: "r-cara",
        confidence: "strong",
        reason: "known_name_and_amount",
      },
    },
    {
      name: "(b) known name but wrong amount falls through to amount tier",
      alert: alert(4200, "CARA LIM", null),
      expected: { kind: "proposed", friendId: "dan", paymentRequestId: "r-dan2", confidence: "weak", reason: "amount_only" },
    },
    {
      name: "(c) unique amount with unknown name is weak",
      alert: alert(2500, "UNKNOWN PERSON", "lunch"),
      expected: { kind: "proposed", friendId: "bob", paymentRequestId: "r-bob", confidence: "weak", reason: "amount_only" },
    },
    {
      name: "amount tie with unknown name is ambiguous, never guessed",
      alert: alert(1000, "UNKNOWN PERSON", null),
      expected: {
        kind: "unmatched",
        reason: "ambiguous",
        tier: "amount_only",
        candidates: [
          { friendId: "cara", paymentRequestId: "r-cara" },
          { friendId: "dan", paymentRequestId: "r-dan" },
        ],
      },
    },
    {
      name: "nothing fits",
      alert: alert(777, "ROBERT TAN", "SLZZZZZZ"),
      expected: { kind: "unmatched", reason: "no_candidates", candidates: [] },
    },
  ];

  it.each(cases)("$name", ({ alert: a, expected }) => {
    expect(matchBankAlert(a, requests, FRIENDS)).toEqual(expected);
  });

  it("(b) two requests for the same amount from the same known friend are ambiguous", () => {
    const twice = [req("r1", "bob", 500, "SLAAAAAA"), req("r2", "bob", 500, "SLAAAAAB")];
    expect(matchBankAlert(alert(500, "ROBERT TAN"), twice, FRIENDS)).toEqual({
      kind: "unmatched",
      reason: "ambiguous",
      tier: "known_name_and_amount",
      candidates: [
        { friendId: "bob", paymentRequestId: "r1" },
        { friendId: "bob", paymentRequestId: "r2" },
      ],
    });
  });

  it("(a) two requests whose references both appear in the text are ambiguous", () => {
    expect(matchBankAlert(alert(2500, null, "SLBBBBBB SLCCCCCC"), requests, FRIENDS)).toMatchObject({
      kind: "unmatched",
      reason: "ambiguous",
      tier: "reference",
    });
  });

  it("with no open requests everything is unmatched", () => {
    expect(matchBankAlert(alert(1000, "CARA LIM", "SLCCCCCC"), [], FRIENDS)).toEqual({
      kind: "unmatched",
      reason: "no_candidates",
      candidates: [],
    });
  });

  it("does not mutate its inputs", () => {
    const frozen = Object.freeze(requests.map((r) => Object.freeze({ ...r })));
    const frozenFriends = Object.freeze(FRIENDS.map((f) => Object.freeze({ ...f, knownBankNames: Object.freeze([...f.knownBankNames]) })));
    expect(() => matchBankAlert(alert(2500), frozen, frozenFriends)).not.toThrow();
  });
});

describe("canAutoConfirm", () => {
  const request = req("r-bob", "bob", 2500, "SLBBBBBB");
  const strong = (reason: "reference" | "known_name_and_amount" | "amount_only"): MatchProposal => ({
    kind: "proposed",
    friendId: "bob",
    paymentRequestId: "r-bob",
    confidence: reason === "amount_only" ? "weak" : "strong",
    reason,
  });

  it("requires reference match + exact amount + known payer name", () => {
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", "SLBBBBBB"), strong("reference"), request, bob)).toBe(true);
    expect(canAutoConfirm(alert(2500, "robert tan", "SLBBBBBB"), strong("reference"), request, bob)).toBe(true);
  });

  it("refuses when any leg is missing", () => {
    expect(canAutoConfirm(alert(2600, "ROBERT TAN", "SLBBBBBB"), strong("reference"), request, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, "STRANGER", "SLBBBBBB"), strong("reference"), request, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, null, "SLBBBBBB"), strong("reference"), request, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", null), strong("known_name_and_amount"), request, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", null), strong("amount_only"), request, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", "SLBBBBBB"), { kind: "unmatched", reason: "no_candidates", candidates: [] }, request, bob)).toBe(false);
  });

  it("refuses a proposal that points at a different request or friend", () => {
    const other = req("r-other", "bob", 2500, "SLOTHER1");
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", "SLBBBBBB"), strong("reference"), other, bob)).toBe(false);
    expect(canAutoConfirm(alert(2500, "ROBERT TAN", "SLBBBBBB"), strong("reference"), request, cara)).toBe(false);
  });
});
