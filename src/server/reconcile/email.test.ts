import { describe, expect, it } from "vitest";

import { DEFAULT_SENDER_ALLOWLIST, inboundEmailConfigFromEnv, verifyInboundSecret } from "./config";
import {
  bodyText,
  extractAddresses,
  extractToken,
  htmlToText,
  InboundEmailSchema,
  isAllowedSender,
  originalSenders,
  rawHash,
  verifiedBankSender,
} from "./email";
import {
  DBS_FAST_MANUAL_FORWARD,
  DBS_HTML_ONLY,
  DBS_PAYNOW_AUTOFORWARD,
  HOST_TOKEN,
  INBOUND_DOMAIN,
  NON_BANK_SENDER,
  SPOOFED_SENDER,
  TO,
} from "./fixtures.test-helpers";

describe("InboundEmailSchema", () => {
  it("accepts the minimal body and defaults subject/text", () => {
    const parsed = InboundEmailSchema.parse({ to: TO, from: "a@b.co", extra: 1 });
    expect(parsed.subject).toBe("");
    expect(parsed.text).toBe("");
  });
  it("rejects a missing recipient", () => {
    expect(InboundEmailSchema.safeParse({ from: "a@b.co" }).success).toBe(false);
  });
});

describe("recipient token", () => {
  it("extracts the local part at our domain from any recipient form", () => {
    expect(extractToken(TO, INBOUND_DOMAIN)).toBe(HOST_TOKEN);
    expect(extractToken(`Alerts <${TO}>`, INBOUND_DOMAIN)).toBe(HOST_TOKEN);
    expect(extractToken(`host@gmail.com, ${TO.toUpperCase()}`, INBOUND_DOMAIN)).toBe(HOST_TOKEN);
    expect(extractToken("host@gmail.com", INBOUND_DOMAIN)).toBeNull();
    expect(extractToken(`${HOST_TOKEN}@evil.${INBOUND_DOMAIN}`, INBOUND_DOMAIN)).toBeNull();
  });
  it("extractAddresses lower-cases and finds every address", () => {
    expect(extractAddresses("A <X@Y.com>, z@w.org")).toEqual(["x@y.com", "z@w.org"]);
    expect(extractAddresses(undefined)).toEqual([]);
  });
});

describe("rawHash", () => {
  it("is sha256 of from+subject+text and ignores html/headers", () => {
    const a = rawHash(DBS_PAYNOW_AUTOFORWARD);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(rawHash({ ...DBS_PAYNOW_AUTOFORWARD, headers: undefined, html: "<p>x</p>" })).toBe(a);
    expect(rawHash({ ...DBS_PAYNOW_AUTOFORWARD, text: DBS_PAYNOW_AUTOFORWARD.text + " " })).not.toBe(a);
  });
});

describe("sender verification", () => {
  it("allowlists exact domains, subdomains and full addresses only", () => {
    expect(isAllowedSender("ibanking.alert@dbs.com", DEFAULT_SENDER_ALLOWLIST)).toBe(true);
    expect(isAllowedSender("Alerts@Mail.DBS.com", DEFAULT_SENDER_ALLOWLIST)).toBe(true);
    expect(isAllowedSender("ibanking.alert@dbs.com.evil.example", DEFAULT_SENDER_ALLOWLIST)).toBe(false);
    expect(isAllowedSender("ibanking.alert@notdbs.com", DEFAULT_SENDER_ALLOWLIST)).toBe(false);
    expect(isAllowedSender("dbs.com", DEFAULT_SENDER_ALLOWLIST)).toBe(false);
    expect(isAllowedSender("x@ocbc.com", ["alerts@ocbc.com"])).toBe(false);
    expect(isAllowedSender("alerts@ocbc.com", ["alerts@ocbc.com"])).toBe(true);
  });

  it("finds the bank in From (auto-forward), in the forwarded block (manual), or nowhere", () => {
    expect(originalSenders(DBS_PAYNOW_AUTOFORWARD)).toEqual(["ibanking.alert@dbs.com"]);
    expect(verifiedBankSender(DBS_PAYNOW_AUTOFORWARD, DEFAULT_SENDER_ALLOWLIST)).toBe("ibanking.alert@dbs.com");
    expect(originalSenders(DBS_FAST_MANUAL_FORWARD)).toEqual(["host@gmail.com", "ibanking.alert@dbs.com"]);
    expect(verifiedBankSender(DBS_FAST_MANUAL_FORWARD, DEFAULT_SENDER_ALLOWLIST)).toBe("ibanking.alert@dbs.com");
    expect(verifiedBankSender(NON_BANK_SENDER, DEFAULT_SENDER_ALLOWLIST)).toBeNull();
    expect(verifiedBankSender(SPOOFED_SENDER, DEFAULT_SENDER_ALLOWLIST)).toBeNull();
  });

  it("also reads x-original-sender style headers", () => {
    const email = { ...NON_BANK_SENDER, text: "hi", headers: { "X-Original-Sender": ["ibanking.alert@dbs.com"] } };
    expect(verifiedBankSender(email, DEFAULT_SENDER_ALLOWLIST)).toBe("ibanking.alert@dbs.com");
  });
});

describe("html", () => {
  it("flattens html to label/value lines when text is blank", () => {
    const text = bodyText(DBS_HTML_ONLY);
    expect(text).toContain("SGD 100.00");
    expect(text).toMatch(/Payer Name\s*: DAN LEE/);
    expect(htmlToText("a&amp;b<br>c")).toBe("a&b\nc");
    expect(bodyText(DBS_PAYNOW_AUTOFORWARD)).toBe(DBS_PAYNOW_AUTOFORWARD.text);
  });
});

describe("config", () => {
  it("is undefined until both domain and secret are set; allowlist defaults to dbs.com", () => {
    expect(inboundEmailConfigFromEnv({})).toBeUndefined();
    expect(inboundEmailConfigFromEnv({ INBOUND_EMAIL_DOMAIN: "in.x.test" })).toBeUndefined();
    expect(inboundEmailConfigFromEnv({ INBOUND_EMAIL_DOMAIN: "IN.X.test ", INBOUND_EMAIL_SECRET: "s" })).toEqual({
      domain: "in.x.test",
      secret: "s",
      senderAllowlist: ["dbs.com"],
    });
    expect(
      inboundEmailConfigFromEnv({ INBOUND_EMAIL_DOMAIN: "d", INBOUND_EMAIL_SECRET: "s", INBOUND_EMAIL_SENDER_ALLOWLIST: " dbs.com, Alerts@OCBC.com ,," })
        ?.senderAllowlist,
    ).toEqual(["dbs.com", "alerts@ocbc.com"]);
  });

  it("verifies the secret in constant time and rejects empty/mismatched values", () => {
    expect(verifyInboundSecret("abc", "abc")).toBe(true);
    expect(verifyInboundSecret("abd", "abc")).toBe(false);
    expect(verifyInboundSecret("ab", "abc")).toBe(false);
    expect(verifyInboundSecret("", "abc")).toBe(false);
    expect(verifyInboundSecret(null, "abc")).toBe(false);
    expect(verifyInboundSecret(undefined, "abc")).toBe(false);
  });
});
