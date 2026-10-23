import { describe, expect, it } from "vitest";

import { argsOf, createMockDb } from "@/server/db/mock-client.test-helpers";

import { confirmBankAlert, HOST_IGNORED_REASON, ignoreBankAlert, reassignBankAlert } from "./actions";
import { alertRow, claimRow, FRIEND2_ID, friendRow, HOST_ID, LEDGER_EVENT_ID, REQUEST2_ID, requestRow } from "./rows.test-helpers";
import { ReconcileError } from "./types";

describe("confirmBankAlert", () => {
  it("creates one bank_alert claim for the alert amount, confirms it with that amount, remembers the payer name", async () => {
    const { db, calls } = createMockDb([
      { data: alertRow({ amount: 2700 }) }, // over-payment: request is 2500
      { data: requestRow() },
      { data: claimRow({ amount: 2700 }) },
      { data: LEDGER_EVENT_ID },
      { data: friendRow({ known_bank_names: ["SOMEONE ELSE"] }) },
      { data: friendRow({ known_bank_names: ["SOMEONE ELSE", "ROBERT TAN"] }) },
      { data: alertRow({ amount: 2700, status: "confirmed" }) },
    ]);
    const result = await confirmBankAlert(db, HOST_ID, alertRow().id, {});
    expect(result.ledgerEventId).toBe(LEDGER_EVENT_ID);
    expect(result.claimId).toBe(claimRow().id);
    expect(result.alert.status).toBe("confirmed");

    expect(calls.map((c) => c.table ?? c.rpc)).toEqual([
      "bank_alerts",
      "payment_requests",
      "payment_claims",
      "confirm_payment_claim",
      "friends",
      "friends",
      "bank_alerts",
    ]);
    expect(argsOf(calls[0], "eq")).toEqual([["host_id", HOST_ID], ["id", alertRow().id]]);
    expect(argsOf(calls[1], "eq")).toEqual([["host_id", HOST_ID], ["id", requestRow().id]]);
    expect(argsOf(calls[2], "insert")[0][0]).toEqual({
      host_id: HOST_ID,
      payment_request_id: requestRow().id,
      source: "bank_alert",
      bank_alert_id: alertRow().id,
      amount: 2700,
    });
    expect(calls[3].rpcArgs).toEqual({ p_claim_id: claimRow().id, p_amount: 2700 });
    expect(argsOf(calls[5], "update")[0][0]).toEqual({ known_bank_names: ["SOMEONE ELSE", "ROBERT TAN"] });
    expect(argsOf(calls[5], "eq")).toEqual([["host_id", HOST_ID], ["id", requestRow().friend_id]]);
  });

  it("does not duplicate an already-known bank name (case/punctuation-insensitive)", async () => {
    const { db, calls } = createMockDb([
      { data: alertRow() },
      { data: requestRow() },
      { data: claimRow() },
      { data: LEDGER_EVENT_ID },
      { data: friendRow({ known_bank_names: ["Robert  Tan"] }) },
      { data: alertRow({ status: "confirmed" }) },
    ]);
    await confirmBankAlert(db, HOST_ID, alertRow().id, {});
    expect(calls.filter((c) => c.table === "friends")).toHaveLength(1);
  });

  it("confirms against a different open request when given one, re-pointing the proposal first", async () => {
    const other = requestRow({ id: REQUEST2_ID, friend_id: FRIEND2_ID, amount: 2500, reference: "SLCCCCCC" });
    const { db, calls } = createMockDb([
      { data: alertRow({ status: "unmatched", proposed_friend_id: null, proposed_payment_request_id: null, match_confidence: null }) },
      { data: other },
      { data: alertRow({ proposed_friend_id: FRIEND2_ID, proposed_payment_request_id: REQUEST2_ID }) },
      { data: claimRow({ payment_request_id: REQUEST2_ID }) },
      { data: LEDGER_EVENT_ID },
      { data: friendRow({ id: FRIEND2_ID, known_bank_names: ["ROBERT TAN"] }) },
      { data: alertRow({ status: "confirmed", proposed_friend_id: FRIEND2_ID, proposed_payment_request_id: REQUEST2_ID }) },
    ]);
    const result = await confirmBankAlert(db, HOST_ID, alertRow().id, { paymentRequestId: REQUEST2_ID });
    expect(result.paymentRequest.id).toBe(REQUEST2_ID);
    expect(argsOf(calls[2], "update")[0][0]).toMatchObject({
      status: "proposed",
      proposed_friend_id: FRIEND2_ID,
      proposed_payment_request_id: REQUEST2_ID,
      match_reason: "host",
    });
    expect(argsOf(calls[3], "insert")[0][0]).toMatchObject({ payment_request_id: REQUEST2_ID, amount: 2500 });
  });

  it("refuses: unknown alert, already confirmed, unmatched without a request, request not open, zero amount", async () => {
    await expect(confirmBankAlert(createMockDb([{ data: null }]).db, HOST_ID, alertRow().id, {})).rejects.toMatchObject({ code: "not_found" });
    await expect(confirmBankAlert(createMockDb([{ data: alertRow({ status: "confirmed" }) }]).db, HOST_ID, alertRow().id, {})).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(
      confirmBankAlert(createMockDb([{ data: alertRow({ status: "unmatched", proposed_payment_request_id: null, proposed_friend_id: null }) }]).db, HOST_ID, alertRow().id, {}),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      confirmBankAlert(createMockDb([{ data: alertRow() }, { data: requestRow({ status: "paid" }) }]).db, HOST_ID, alertRow().id, {}),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(confirmBankAlert(createMockDb([{ data: alertRow({ amount: 0, status: "unmatched" }) }]).db, HOST_ID, alertRow().id, {})).rejects.toBeInstanceOf(
      ReconcileError,
    );
  });
});

describe("reassignBankAlert / ignoreBankAlert", () => {
  it("reassign points the proposal at the new open request and its friend, host-scoped", async () => {
    const other = requestRow({ id: REQUEST2_ID, friend_id: FRIEND2_ID });
    const { db, calls } = createMockDb([{ data: alertRow() }, { data: other }, { data: alertRow({ proposed_friend_id: FRIEND2_ID }) }]);
    const alert = await reassignBankAlert(db, HOST_ID, alertRow().id, REQUEST2_ID);
    expect(alert.proposedFriendId).toBe(FRIEND2_ID);
    expect(argsOf(calls[2], "update")[0][0]).toEqual({
      status: "proposed",
      reason: null,
      proposed_friend_id: FRIEND2_ID,
      proposed_payment_request_id: REQUEST2_ID,
      match_confidence: null,
      match_reason: "host",
    });
    expect(argsOf(calls[2], "eq")).toEqual([["host_id", HOST_ID], ["id", alertRow().id]]);
    expect(calls.some((c) => c.rpc || c.table === "payment_claims")).toBe(false);
  });

  it("reassign rejects a request that is not open", async () => {
    const { db } = createMockDb([{ data: alertRow() }, { data: requestRow({ status: "cancelled" }) }]);
    await expect(reassignBankAlert(db, HOST_ID, alertRow().id, requestRow().id)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("ignore marks the alert ignored with the host's reason (default host_ignored) and clears the proposal", async () => {
    const { db, calls } = createMockDb([{ data: alertRow() }, { data: alertRow({ status: "ignored", reason: HOST_IGNORED_REASON }) }]);
    const alert = await ignoreBankAlert(db, HOST_ID, alertRow().id, "  ");
    expect(alert.status).toBe("ignored");
    expect(argsOf(calls[1], "update")[0][0]).toMatchObject({
      status: "ignored",
      reason: HOST_IGNORED_REASON,
      proposed_friend_id: null,
      proposed_payment_request_id: null,
    });
    const { db: db2, calls: calls2 } = createMockDb([{ data: alertRow() }, { data: alertRow({ status: "ignored" }) }]);
    await ignoreBankAlert(db2, HOST_ID, alertRow().id, "not a split");
    expect(argsOf(calls2[1], "update")[0][0]).toMatchObject({ reason: "not a split" });
  });

  it("ignore refuses an already confirmed alert", async () => {
    const { db } = createMockDb([{ data: alertRow({ status: "confirmed" }) }]);
    await expect(ignoreBankAlert(db, HOST_ID, alertRow().id)).rejects.toMatchObject({ code: "invalid_state" });
  });
});
