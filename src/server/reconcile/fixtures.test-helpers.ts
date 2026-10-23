import type { InboundEmail } from "./types";

export const HOST_TOKEN = "a3f9c2d1e4b5f6a7b8c9d0e1f2a3b4c5";
export const INBOUND_DOMAIN = "in.settlelah.test";
export const TO = `${HOST_TOKEN}@${INBOUND_DOMAIN}`;

/** Gmail filter auto-forward: the bank stays in From, Gmail adds X-Forwarded-* headers. */
export const DBS_PAYNOW_AUTOFORWARD: InboundEmail = {
  to: TO,
  from: "DBS Bank <ibanking.alert@dbs.com>",
  subject: "Incoming PayNow Transfer",
  text: [
    "Dear Sir/Madam,",
    "",
    "You have received an incoming PayNow transfer of SGD 25.00 on 12 Jan 2025 at 14:05 (SGT).",
    "",
    "Payer's Name: ROBERT TAN",
    "Payer's Reference / Other info: SLBBBBBB",
    "Account credited: DBS Multiplier Account ending 1234",
    "",
    "This is an auto-generated email. Please do not reply.",
  ].join("\n"),
  headers: { date: "Sun, 12 Jan 2025 06:05:10 +0000", "x-forwarded-to": TO, "x-forwarded-for": "host@gmail.com " + TO },
};

/** Manual Gmail forward: the host is in From, the bank is in the forwarded block. */
export const DBS_FAST_MANUAL_FORWARD: InboundEmail = {
  to: `Alerts <${TO}>`,
  from: "Host Person <host@gmail.com>",
  subject: "Fwd: Funds credited to your account",
  text: [
    "FYI",
    "",
    "---------- Forwarded message ---------",
    "From: DBS Bank <ibanking.alert@dbs.com>",
    "Date: Mon, 3 Feb 2025 at 09:15",
    "Subject: Funds credited to your account",
    "To: <host@gmail.com>",
    "",
    "Dear Customer,",
    "",
    "A FAST transfer of SGD1,234.50 has been credited to your account ending 5678 on 03/02/2025 09:14 from TAN AH KOW.",
    "Transaction Ref: 20250203FAST000123",
    "Other Info: dinner slcccccc",
    "",
    "Regards, DBS",
  ].join("\n"),
};

/** POSB wording with S$ amount, 12-hour time, no reference. */
export const POSB_PAYNOW_NO_REFERENCE: InboundEmail = {
  to: TO,
  from: "POSB <ibanking.alert@dbs.com>",
  subject: "POSB: You have received a PayNow transfer",
  text: [
    "Dear Customer",
    "",
    "You have received S$8.80 via PayNow on 05 Mar 2025, 11:42 PM.",
    "From: LIM MEI CARA",
    "Reference: -",
    "Credited to: POSB Savings ending 4321",
  ].join("\n"),
};

/** HTML-only body. */
export const DBS_HTML_ONLY: InboundEmail = {
  to: TO,
  from: "ibanking.alert@dbs.com",
  subject: "Incoming PayNow Transfer",
  text: "",
  html:
    "<html><body><p>Dear Customer,</p><p>You have received an incoming PayNow transfer of <b>SGD 100.00</b> on 2025-04-01 08:00:00.</p>" +
    "<table><tr><td>Payer Name</td><td>: DAN LEE</td></tr><tr><td>Reference</td><td>: SLDDDDDD</td></tr></table></body></html>",
};

/** Spoof: looks like a DBS alert but the only sender is not at dbs.com (lookalike domain). */
export const SPOOFED_SENDER: InboundEmail = {
  to: TO,
  from: "DBS Bank <ibanking.alert@dbs.com.evil.example>",
  subject: "Incoming PayNow Transfer",
  text: "You have received an incoming PayNow transfer of SGD 999.00 on 12 Jan 2025 14:05.\nPayer's Name: ROBERT TAN\nReference: SLBBBBBB",
};

/** Forwarded by the host but the original sender is not a bank. */
export const NON_BANK_SENDER: InboundEmail = {
  to: TO,
  from: "Host Person <host@gmail.com>",
  subject: "Fwd: Your Grab receipt",
  text: "---------- Forwarded message ---------\nFrom: Grab <no-reply@grab.com>\nSubject: Your Grab receipt\n\nYou paid SGD 12.00 for a ride.",
};

/** Verified bank sender, but not a format we understand. */
export const DBS_UNKNOWN_FORMAT: InboundEmail = {
  to: TO,
  from: "DBS Bank <ibanking.alert@dbs.com>",
  subject: "Your DBS card transaction",
  text: "A transaction of SGD 45.00 was made with your DBS card ending 9999 at STARBUCKS on 12 Jan 2025.",
};

/** Garbage. */
export const GARBAGE: InboundEmail = {
  to: TO,
  from: "ibanking.alert@dbs.com",
  subject: "DBS PayNow",
  text: "lorem ipsum PayNow DBS \u0000\u0001 ???",
};
