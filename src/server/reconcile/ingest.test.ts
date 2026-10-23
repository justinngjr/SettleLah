import { describe, expect, it } from "vitest";

import { argsOf, chainOf, createMockDb, type RecordedCall } from "@/server/db/mock-client.test-helpers";

import { DEFAULT_SENDER_ALLOWLIST, type InboundEmailConfig } from "./config";
import { rawHash } from "./email";
import {
  DBS_FAST_MANUAL_FORWARD,
  DBS_PAYNOW_AUTOFORWARD,
  DBS_UNKNOWN_FORMAT,
  GARBAGE,
  INBOUND_DOMAIN,
  NON_BANK_SENDER,
  SPOOFED_SENDER,
} from "./fixtures.test-helpers";
import { INGEST_REASONS, ingestInboundEmail } from "./ingest";
import {
  alertRow,
  claimRow,
  FRIEND2_ID,
  FRIEND_ID,
  friendRow,
  HOST_ID,
  LEDGER_EVENT_ID,
  REQUEST2_ID,
  REQUEST_ID,
  requestRow,
  routeRow,
} from "./rows.test-helpers";
import { ReconcileError } from "./types";

const CONFIG: InboundEmailConfig = { domain: INBOUND_DOMAIN, secret: "s", senderAllowlist: DEFAULT_SENDER_ALLOWLIST };

function insertedAlert(call: RecordedCall): Record<string, unknown> {
  expect(call.table).toBe("bank_alerts");
  return argsOf(call, "insert")[0][0] as Record<string, unknown>;
}

/** Every bank_alerts / payment_requests / friends / payment_claims query must carry `.eq("host_id", HOST_ID)`. */
function expectHostScoped(calls: readonly RecordedCall[]) {
  for (const call of calls) {
    if (call.rpc || call.table === "inbound_email_routes" || call.table === "profiles") continue;
    if (chainOf(call).includes("insert")) {
      expect((argsOf(call, "insert")[0][0] as { host_id: string }).host_id, `${call.table} insert`).toBe(HOST_ID);
    } else {
      expect(argsOf(call, "eq"), `${call.table} ${chainOf(call).join(".")}`).toContainEqual(["host_id", HOST_ID]);
    }
  }
}

describe("ingestInboundEmail", () => {
  it("rejects a recipient outside our domain or an unknown/revoked token without touching other tables", async () => {
    const { db, calls } = createMockDb([]);
    await expect(ingestInboundEmail(db, CONFIG, { ...DBS_PAYNOW_AUTOFORWARD, to: "host@gmail.com" })).rejects.toBeInstanceOf(ReconcileError);
    expect(calls).toHaveLength(0);

    const { db: db2, calls: calls2 } = createMockDb([{ data: null }]);
    await expect(ingestInboundEmail(db2, CONFIG, DBS_PAYNOW_AUTOFORWARD)).rejects.toMatchObject({ code: "not_found" });
    expect(calls2).toHaveLength(1);
    expect(calls2[0].table).toBe("inbound_email_routes");
    expect(argsOf(calls2[0], "eq")).toEqual([["token", "a3f9c2d1e4b5f6a7b8c9d0e1f2a3b4c5"]]);
    expect(argsOf(calls2[0], "is")).toEqual([["revoked_at", null]]);
  });

  it("is idempotent on raw_hash: a re-delivery returns the stored alert and inserts nothing", async () => {
    const existing = alertRow({ raw_hash: rawHash(DBS_PAYNOW_AUTOFORWARD) });
    const { db, calls } = createMockDb([{ data: routeRow() }, { data: existing }]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("duplicate");
    expect(result.alert.id).toBe(existing.id);
    expect(calls).toHaveLength(2);
    expect(argsOf(calls[1], "eq")).toEqual([["host_id", HOST_ID], ["raw_hash", existing.raw_hash]]);
  });

  it("treats a unique-violation on insert (racing deliveries) as a duplicate", async () => {
    const existing = alertRow();
    const { db } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [] },
      { data: [] },
      { error: { message: "duplicate key value violates unique constraint", code: "23505" } },
      { data: existing },
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("duplicate");
  });

  it.each([
    ["spoofed lookalike domain", SPOOFED_SENDER],
    ["non-bank forwarded sender", NON_BANK_SENDER],
  ])("stores an alert from an unverified sender as ignored (%s), never the body", async (_label, email) => {
    const { db, calls } = createMockDb([{ data: routeRow() }, { data: null }, { data: alertRow({ status: "ignored", amount: 0 }) }]);
    const result = await ingestInboundEmail(db, CONFIG, email);
    expect(result.outcome).toBe("ignored");
    const inserted = insertedAlert(calls[2]);
    expect(inserted).toMatchObject({
      host_id: HOST_ID,
      status: "ignored",
      reason: INGEST_REASONS.senderNotVerified,
      amount: 0,
      sender: null,
      raw_hash: rawHash(email),
    });
    expect(JSON.stringify(inserted)).not.toContain(email.text.slice(0, 40));
    expect(inserted).not.toHaveProperty("text");
    expect(inserted).not.toHaveProperty("html");
    expectHostScoped(calls);
  });

  it("stores a verified-sender email in an unknown format as ignored/unsupported_format", async () => {
    const { db, calls } = createMockDb([{ data: routeRow() }, { data: null }, { data: alertRow({ status: "ignored", amount: 0 }) }]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_UNKNOWN_FORMAT);
    expect(result.outcome).toBe("ignored");
    expect(insertedAlert(calls[2])).toMatchObject({ status: "ignored", reason: INGEST_REASONS.unsupportedFormat, sender: "ibanking.alert@dbs.com" });
  });

  it("stores garbage from the bank as unmatched/parse_failed instead of throwing", async () => {
    const { db, calls } = createMockDb([{ data: routeRow() }, { data: null }, { data: alertRow({ status: "unmatched", amount: 0 }) }]);
    const result = await ingestInboundEmail(db, CONFIG, GARBAGE);
    expect(result.outcome).toBe("unmatched");
    expect(insertedAlert(calls[2])).toMatchObject({ status: "unmatched", reason: INGEST_REASONS.parseFailed, bank: "DBS", amount: 0 });
  });

  it("parses, matches by reference and stores a strong proposal (no ledger write)", async () => {
    const { db, calls } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [requestRow(), requestRow({ id: REQUEST2_ID, friend_id: FRIEND2_ID, amount: 2500, reference: "SLCCCCCC" })] },
      { data: [friendRow()] },
      { data: alertRow() },
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("proposed");
    expect(calls.map((c) => c.table ?? c.rpc)).toEqual(["inbound_email_routes", "bank_alerts", "payment_requests", "friends", "bank_alerts"]);
    expect(argsOf(calls[2], "eq")).toEqual([["host_id", HOST_ID], ["status", "open"]]);
    expect(insertedAlert(calls[4])).toEqual({
      host_id: HOST_ID,
      bank: "DBS",
      raw_hash: rawHash(DBS_PAYNOW_AUTOFORWARD),
      subject: "Incoming PayNow Transfer",
      received_at: "2025-01-12T06:05:00.000Z",
      amount: 2500,
      payer_name: "ROBERT TAN",
      reference: "SLBBBBBB",
      sender: "ibanking.alert@dbs.com",
      status: "proposed",
      reason: null,
      proposed_friend_id: FRIEND_ID,
      proposed_payment_request_id: REQUEST_ID,
      match_confidence: "strong",
      match_reason: "reference",
    });
    expect(calls.some((c) => c.rpc)).toBe(false);
    expectHostScoped(calls);
  });

  it("stores an ambiguous amount-only match as unmatched/ambiguous", async () => {
    const { db, calls } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [requestRow({ reference: "SLXXXXXX", amount: 123450 }), requestRow({ id: REQUEST2_ID, friend_id: FRIEND2_ID, reference: "SLYYYYYY", amount: 123450 })] },
      { data: [] },
      { data: alertRow({ status: "unmatched" }) },
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_FAST_MANUAL_FORWARD);
    expect(result.outcome).toBe("unmatched");
    expect(insertedAlert(calls[4])).toMatchObject({
      status: "unmatched",
      reason: "ambiguous",
      match_reason: "amount_only",
      proposed_friend_id: null,
      proposed_payment_request_id: null,
      amount: 123450,
    });
  });

  it("does not auto-confirm a qualifying match while the host setting is off", async () => {
    const { db, calls } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [requestRow()] },
      { data: [friendRow({ known_bank_names: ["ROBERT TAN"] })] },
      { data: alertRow() },
      { data: { auto_confirm_bank_alerts: false } },
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("proposed");
    expect(calls.at(-1)?.table).toBe("profiles");
    expect(argsOf(calls.at(-1)!, "eq")).toEqual([["id", HOST_ID]]);
    expect(calls.some((c) => c.rpc)).toBe(false);
  });

  it("does not consult the setting when the match is not the exact-reference/known-name/exact-amount case", async () => {
    const { db, calls } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [requestRow({ amount: 2000 })] },
      { data: [friendRow({ known_bank_names: ["ROBERT TAN"] })] },
      { data: alertRow() },
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("proposed");
    expect(calls.some((c) => c.table === "profiles")).toBe(false);
  });

  it("auto-confirms when opted in: one bank_alert claim for the alert amount, one confirm RPC", async () => {
    const { db, calls } = createMockDb([
      { data: routeRow() },
      { data: null },
      { data: [requestRow()] },
      { data: [friendRow({ known_bank_names: ["ROBERT TAN"] })] },
      { data: alertRow() },
      { data: { auto_confirm_bank_alerts: true } },
      // confirmBankAlert:
      { data: alertRow() }, // getBankAlert
      { data: requestRow() }, // getOpenRequest
      { data: claimRow() }, // createPaymentClaim
      { data: LEDGER_EVENT_ID }, // confirm_payment_claim
      { data: friendRow({ known_bank_names: ["ROBERT TAN"] }) }, // getFriend (already known -> no update)
      { data: alertRow({ status: "confirmed" }) }, // getBankAlert
    ]);
    const result = await ingestInboundEmail(db, CONFIG, DBS_PAYNOW_AUTOFORWARD);
    expect(result.outcome).toBe("confirmed");
    expect(result.ledgerEventId).toBe(LEDGER_EVENT_ID);
    expect(result.alert.status).toBe("confirmed");
    const claimInsert = calls.find((c) => c.table === "payment_claims");
    expect(claimInsert && argsOf(claimInsert, "insert")[0][0]).toEqual({
      host_id: HOST_ID,
      payment_request_id: REQUEST_ID,
      source: "bank_alert",
      bank_alert_id: alertRow().id,
      amount: 2500,
    });
    const rpcs = calls.filter((c) => c.rpc);
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toMatchObject({ rpc: "confirm_payment_claim", rpcArgs: { p_claim_id: claimRow().id, p_amount: 2500 } });
    expectHostScoped(calls);
  });
});
