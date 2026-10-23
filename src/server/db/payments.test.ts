import { describe, expect, it } from "vitest";

import { argsOf, createMockDb } from "./mock-client.test-helpers";
import {
  cancelPaymentRequest,
  confirmPaymentClaim,
  createPaymentClaim,
  createPaymentRequest,
  generateReference,
  isValidReference,
  REFERENCE_ALPHABET,
  rejectPaymentClaim,
  toPaymentRequest,
  type PaymentRequestRow,
} from "./payments";

const ROW: PaymentRequestRow = {
  id: "pr1",
  host_id: "h1",
  friend_id: "f1",
  amount: 1234,
  reference: "SLABCDEF",
  status: "open",
  note: null,
  created_at: "2026-01-01T00:00:00Z",
  paid_at: null,
  cancelled_at: null,
};

const COLLISION = {
  message: 'duplicate key value violates unique constraint "payment_requests_reference_key"',
  code: "23505",
  details: "Key (reference)=(SLABCDEF) already exists.",
};

describe("payment references", () => {
  it("are SL + 6 symbols from the unambiguous alphabet", () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(REFERENCE_ALPHABET).not.toMatch(/[01IO]/);
    for (let i = 0; i < 200; i++) {
      const ref = generateReference();
      expect(ref).toMatch(/^SL[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(isValidReference(ref)).toBe(true);
    }
    expect(isValidReference("SL0OI1AB")).toBe(false);
    expect(isValidReference("slabcdef")).toBe(false);
  });

  it("use every byte uniformly", () => {
    expect(generateReference(() => new Uint8Array([0, 31, 32, 63, 255, 1]))).toBe("SL2Z2ZZ3");
  });
});

describe("createPaymentRequest", () => {
  it("inserts an open request with a generated reference", async () => {
    const { db, calls } = createMockDb([{ data: ROW }]);
    const request = await createPaymentRequest(db, "h1", { friendId: "f1", amount: 1234 }, { generateReference: () => "SLABCDEF" });
    expect(request).toEqual(toPaymentRequest(ROW));
    expect(argsOf(calls[0], "insert")[0][0]).toEqual({
      host_id: "h1",
      friend_id: "f1",
      amount: 1234,
      reference: "SLABCDEF",
      note: null,
    });
  });

  it("retries with a fresh reference on a unique violation", async () => {
    const refs = ["SLAAAAAA", "SLBBBBBB", "SLCCCCCC"];
    const { db, calls } = createMockDb([{ error: COLLISION }, { error: COLLISION }, { data: { ...ROW, reference: "SLCCCCCC" } }]);
    const request = await createPaymentRequest(
      db,
      "h1",
      { friendId: "f1", amount: 1234 },
      { generateReference: () => refs.shift() ?? "SLZZZZZZ" },
    );
    expect(request.reference).toBe("SLCCCCCC");
    expect(calls.map((c) => (argsOf(c, "insert")[0][0] as { reference: string }).reference)).toEqual([
      "SLAAAAAA",
      "SLBBBBBB",
      "SLCCCCCC",
    ]);
  });

  it("gives up after maxAttempts collisions", async () => {
    const { db, calls } = createMockDb([{ error: COLLISION }, { error: COLLISION }]);
    await expect(createPaymentRequest(db, "h1", { friendId: "f1", amount: 1 }, { maxAttempts: 2 })).rejects.toThrow(
      /no unique reference after 2 attempts/,
    );
    expect(calls).toHaveLength(2);
  });

  it("does not retry other errors", async () => {
    const other = { message: "insert or update on table violates foreign key constraint", code: "23503" };
    const { db, calls } = createMockDb([{ error: other }]);
    await expect(createPaymentRequest(db, "h1", { friendId: "nope", amount: 1 })).rejects.toMatchObject({ code: "23503" });
    expect(calls).toHaveLength(1);
  });

  it("rejects zero or negative amounts before touching the database", async () => {
    const { db, calls } = createMockDb();
    await expect(createPaymentRequest(db, "h1", { friendId: "f1", amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(createPaymentRequest(db, "h1", { friendId: "f1", amount: -5 })).rejects.toThrow(/negative/);
    expect(calls).toHaveLength(0);
  });
});

describe("payment request and claim state changes", () => {
  it("cancelPaymentRequest only cancels open requests", async () => {
    const { db, calls } = createMockDb([{ data: { ...ROW, status: "cancelled", cancelled_at: "2026-01-02T00:00:00Z" } }]);
    const request = await cancelPaymentRequest(db, "h1", "pr1");
    expect(request.status).toBe("cancelled");
    expect(argsOf(calls[0], "update")[0][0]).toMatchObject({ status: "cancelled" });
    expect(argsOf(calls[0], "eq")).toEqual([
      ["host_id", "h1"],
      ["id", "pr1"],
      ["status", "open"],
    ]);
  });

  it("createPaymentClaim records a pending proposal, never a ledger event", async () => {
    const { db, calls } = createMockDb([
      {
        data: {
          id: "c1",
          host_id: "h1",
          payment_request_id: "pr1",
          claimed_at: "2026-01-01T00:00:00Z",
          source: "friend_button",
          bank_alert_id: null,
          status: "pending",
          resolved_at: null,
        },
      },
    ]);
    const claim = await createPaymentClaim(db, "h1", { paymentRequestId: "pr1", source: "friend_button" });
    expect(claim).toMatchObject({ id: "c1", status: "pending", bankAlertId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("payment_claims");
    expect(argsOf(calls[0], "insert")[0][0]).toEqual({
      host_id: "h1",
      payment_request_id: "pr1",
      source: "friend_button",
      bank_alert_id: null,
    });
  });

  it("confirm/reject delegate to the atomic RPCs", async () => {
    const { db, calls } = createMockDb([{ data: "ledger-event-1" }, { data: null }]);
    expect(await confirmPaymentClaim(db, "c1")).toBe("ledger-event-1");
    await rejectPaymentClaim(db, "c2");
    expect(calls).toEqual([
      expect.objectContaining({ rpc: "confirm_payment_claim", rpcArgs: { p_claim_id: "c1" } }),
      expect.objectContaining({ rpc: "reject_payment_claim", rpcArgs: { p_claim_id: "c2" } }),
    ]);
  });

  it("confirm surfaces the RPC's check violation (e.g. claim no longer pending)", async () => {
    const { db } = createMockDb([{ error: { message: "confirm_payment_claim: claim is not pending", code: "23514" } }]);
    await expect(confirmPaymentClaim(db, "c1")).rejects.toMatchObject({ name: "DbError", code: "23514" });
  });
});
