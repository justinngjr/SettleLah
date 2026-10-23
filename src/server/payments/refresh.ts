import "server-only";

import { outstandingRequest } from "@/domain";
import { cancelPaymentRequest, createPaymentRequest, DbError, listPaymentRequests, loadLedger, type DbClient } from "@/server/db";

/**
 * Each friend has at most one open request: cancel any open ones and open a
 * new one for the outstanding amount after credit (if > 0).
 */
export async function refreshPaymentRequests(db: DbClient, hostId: string, friendIds: readonly string[]): Promise<void> {
  if (friendIds.length === 0) return;
  const [ledger, open] = await Promise.all([loadLedger(db, hostId), listPaymentRequests(db, hostId, { status: "open" })]);
  for (const friendId of friendIds) {
    const outstanding = outstandingRequest(ledger, friendId);
    const existing = open.filter((r) => r.friendId === friendId);
    if (existing.length === 1 && existing[0].amount === outstanding) continue;
    for (const request of existing) {
      try {
        await cancelPaymentRequest(db, hostId, request.id);
      } catch (error) {
        if (!(error instanceof DbError)) throw error;
      }
    }
    if (outstanding > 0) await createPaymentRequest(db, hostId, { friendId, amount: outstanding });
  }
}
