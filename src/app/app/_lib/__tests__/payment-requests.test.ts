import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLedger: vi.fn(),
  listPaymentRequests: vi.fn(),
  cancelPaymentRequest: vi.fn(),
  createPaymentRequest: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  loadLedger: mocks.loadLedger,
  listPaymentRequests: mocks.listPaymentRequests,
  cancelPaymentRequest: mocks.cancelPaymentRequest,
  createPaymentRequest: mocks.createPaymentRequest,
  DbError: class DbError extends Error {},
}));

import { refreshPaymentRequests } from "../payment-requests";

const db = {} as never;
const HOST = "host-1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cancelPaymentRequest.mockResolvedValue(undefined);
  mocks.createPaymentRequest.mockResolvedValue(undefined);
});

describe("refreshPaymentRequests", () => {
  it("cancels the stale open request and opens one for the new outstanding total", async () => {
    mocks.loadLedger.mockResolvedValue([
      { type: "expense_share", friendId: "f-1", amount: 1000 },
      { type: "expense_share", friendId: "f-1", amount: 500 },
    ]);
    mocks.listPaymentRequests.mockResolvedValue([{ id: "req-old", friendId: "f-1", amount: 1000 }]);

    await refreshPaymentRequests(db, HOST, ["f-1"]);

    expect(mocks.cancelPaymentRequest).toHaveBeenCalledWith(db, HOST, "req-old");
    expect(mocks.createPaymentRequest).toHaveBeenCalledWith(db, HOST, { friendId: "f-1", amount: 1500 });
  });

  it("leaves a matching open request alone", async () => {
    mocks.loadLedger.mockResolvedValue([{ type: "expense_share", friendId: "f-1", amount: 1000 }]);
    mocks.listPaymentRequests.mockResolvedValue([{ id: "req", friendId: "f-1", amount: 1000 }]);
    await refreshPaymentRequests(db, HOST, ["f-1"]);
    expect(mocks.cancelPaymentRequest).not.toHaveBeenCalled();
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });

  it("nets credit off and opens nothing when the friend owes nothing", async () => {
    mocks.loadLedger.mockResolvedValue([
      { type: "expense_share", friendId: "f-1", amount: 1000 },
      { type: "credit", friendId: "f-1", amount: 1200 },
    ]);
    mocks.listPaymentRequests.mockResolvedValue([{ id: "req", friendId: "f-1", amount: 1000 }]);
    await refreshPaymentRequests(db, HOST, ["f-1"]);
    expect(mocks.cancelPaymentRequest).toHaveBeenCalledWith(db, HOST, "req");
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });

  it("only touches the friends it is given", async () => {
    mocks.loadLedger.mockResolvedValue([{ type: "expense_share", friendId: "f-2", amount: 700 }]);
    mocks.listPaymentRequests.mockResolvedValue([{ id: "req-2", friendId: "f-2", amount: 100 }]);
    await refreshPaymentRequests(db, HOST, ["f-1"]);
    expect(mocks.cancelPaymentRequest).not.toHaveBeenCalled();
    expect(mocks.createPaymentRequest).not.toHaveBeenCalled();
  });
});
