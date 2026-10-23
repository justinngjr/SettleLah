import { beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "host-1";
const db = { tag: "db" };

const mocks = vi.hoisted(() => ({
  requireHost: vi.fn(),
  confirmBankAlert: vi.fn(),
  reassignBankAlert: vi.fn(),
  ignoreBankAlert: vi.fn(),
  listBankAlerts: vi.fn(),
  updateReconcileSettings: vi.fn(),
  listPaymentRequests: vi.fn(),
  getFriend: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../_lib/host", () => ({ requireHost: mocks.requireHost }));
vi.mock("@/server/db", () => ({ listPaymentRequests: mocks.listPaymentRequests, getFriend: mocks.getFriend }));
vi.mock("@/server/reconcile", () => ({
  confirmBankAlert: mocks.confirmBankAlert,
  reassignBankAlert: mocks.reassignBankAlert,
  ignoreBankAlert: mocks.ignoreBankAlert,
  listBankAlerts: mocks.listBankAlerts,
  updateReconcileSettings: mocks.updateReconcileSettings,
}));

import { bankProposals, describeMatchReason } from "../../_lib/bank-proposals";
import { resolveBankProposal, setAutoConfirmBankAlerts } from "../bank";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHost.mockResolvedValue({ host: { id: HOST }, db });
  mocks.confirmBankAlert.mockResolvedValue({});
  mocks.reassignBankAlert.mockResolvedValue({});
  mocks.ignoreBankAlert.mockResolvedValue({});
  mocks.updateReconcileSettings.mockResolvedValue({ autoConfirmBankAlerts: true });
});

describe("bankProposals.list", () => {
  it("joins proposed and unmatched alerts with friend names, request references and the matcher's reason", async () => {
    mocks.listBankAlerts.mockResolvedValue([
      {
        id: "a1",
        bank: "DBS",
        amount: 1000,
        payerName: "SARAH TAN",
        reference: "SLABCDEF",
        receivedAt: "2026-01-01T00:00:00Z",
        status: "proposed",
        proposedFriendId: "f1",
        proposedPaymentRequestId: "r1",
        matchConfidence: "strong",
        matchReason: "reference_exact",
        reason: null,
      },
      {
        id: "a2",
        bank: "POSB",
        amount: 500,
        payerName: null,
        reference: null,
        receivedAt: "2026-01-02T00:00:00Z",
        status: "unmatched",
        proposedFriendId: null,
        proposedPaymentRequestId: null,
        matchConfidence: null,
        matchReason: null,
        reason: "no_open_request",
      },
    ]);
    mocks.listPaymentRequests.mockResolvedValue([{ id: "r1", friendId: "f1", reference: "SLABCDEF", amount: 1000, status: "open" }]);
    mocks.getFriend.mockResolvedValue({ id: "f1", displayName: "Sarah" });

    const list = await bankProposals.list(db as never, HOST);
    expect(mocks.listBankAlerts).toHaveBeenCalledWith(db, HOST, { status: ["proposed", "unmatched"], limit: 50 });
    expect(mocks.getFriend).toHaveBeenCalledWith(db, HOST, "f1");
    expect(list[0]).toMatchObject({
      id: "a1",
      proposedFriendName: "Sarah",
      proposedRequestReference: "SLABCDEF",
      confidence: "strong",
      reason: "reference_exact",
    });
    expect(list[1]).toMatchObject({ id: "a2", proposedFriendName: null, confidence: null, reason: "no_open_request" });
    expect(describeMatchReason("reference_exact")).toMatch(/reference matches/);
    expect(describeMatchReason("some_new_code")).toBe("some new code");
    expect(describeMatchReason(null)).toBeNull();
  });
});

describe("resolveBankProposal", () => {
  it("confirms the proposed request and revalidates balances", async () => {
    const result = await resolveBankProposal({}, form({ proposalId: "a1", decision: "confirm" }));
    expect(result).toEqual({ ok: true, done: "confirmed" });
    expect(mocks.confirmBankAlert).toHaveBeenCalledWith(db, HOST, "a1", {});
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/inbox");
  });

  it("reassign + confirm passes the chosen request to confirmBankAlert", async () => {
    await resolveBankProposal({}, form({ proposalId: "a1", decision: "confirm", paymentRequestId: "r9" }));
    expect(mocks.confirmBankAlert).toHaveBeenCalledWith(db, HOST, "a1", { paymentRequestId: "r9" });
  });

  it("reassign only re-points the proposal and requires a request", async () => {
    expect(await resolveBankProposal({}, form({ proposalId: "a1", decision: "reassign" }))).toEqual({ error: expect.stringMatching(/^Request/) });
    expect(mocks.reassignBankAlert).not.toHaveBeenCalled();
    const result = await resolveBankProposal({}, form({ proposalId: "a1", decision: "reassign", paymentRequestId: "r2" }));
    expect(result).toEqual({ ok: true, done: "reassigned" });
    expect(mocks.reassignBankAlert).toHaveBeenCalledWith(db, HOST, "a1", "r2");
    expect(mocks.confirmBankAlert).not.toHaveBeenCalled();
  });

  it("ignores with a host reason", async () => {
    const result = await resolveBankProposal({}, form({ proposalId: "a1", decision: "ignore" }));
    expect(result).toEqual({ ok: true, done: "ignored" });
    expect(mocks.ignoreBankAlert).toHaveBeenCalledWith(db, HOST, "a1", "host_ignored");
  });

  it("turns server failures into a form error", async () => {
    mocks.confirmBankAlert.mockRejectedValue(new Error("already confirmed"));
    const result = await resolveBankProposal({}, form({ proposalId: "a1", decision: "confirm" }));
    expect(result.error).toMatch(/Could not update/);
  });
});

describe("setAutoConfirmBankAlerts", () => {
  it("writes the toggle for the signed-in host only", async () => {
    await setAutoConfirmBankAlerts(form({ autoConfirm: "true" }));
    expect(mocks.updateReconcileSettings).toHaveBeenCalledWith(db, HOST, { autoConfirmBankAlerts: true });
    await setAutoConfirmBankAlerts(form({ autoConfirm: "false" }));
    expect(mocks.updateReconcileSettings).toHaveBeenLastCalledWith(db, HOST, { autoConfirmBankAlerts: false });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/settings");
  });
});
