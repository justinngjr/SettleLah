"use server";

import { revalidatePath } from "next/cache";

import {
  appendLedgerEvent,
  confirmPaymentClaim,
  createPaymentClaim,
  listPaymentRequests,
  rejectPaymentClaim,
} from "@/server/db";

import { parseDollars } from "../_lib/cents";
import { requireHost } from "../_lib/host";
import { refreshPaymentRequests } from "../_lib/payment-requests";

export interface MoneyFormState {
  readonly error?: string;
  readonly ok?: boolean;
}

function revalidateFriend(friendId: string): void {
  revalidatePath("/app");
  revalidatePath("/app/inbox");
  revalidatePath("/app/friends");
  revalidatePath(`/app/friends/${friendId}`);
}

/**
 * Host records a payment received outside the app: create a claim for the
 * amount actually received, then confirm it. Overpayment becomes credit.
 */
export async function recordPayment(_prev: MoneyFormState, formData: FormData): Promise<MoneyFormState> {
  const friendId = String(formData.get("friendId") ?? "");
  const amount = parseDollars(String(formData.get("amount") ?? ""));
  if (amount === null || amount <= 0) return { error: "Amount: enter the amount received, e.g. 12.50." };

  const { host, db } = await requireHost(`/app/friends/${friendId}`);
  const [request] = await listPaymentRequests(db, host.id, { friendId, status: "open" });
  if (!request) return { error: "There is no open request for this friend to record a payment against." };

  try {
    const claim = await createPaymentClaim(db, host.id, { paymentRequestId: request.id, source: "friend_button", amount });
    await confirmPaymentClaim(db, claim.id, amount);
    await refreshPaymentRequests(db, host.id, [friendId]);
  } catch (error) {
    console.error("[recordPayment]", error);
    return { error: "Could not record this payment. Try again." };
  }
  revalidateFriend(friendId);
  return { ok: true };
}

/** Host gives a friend credit (e.g. the friend paid for something). Reduces what they owe. */
export async function addCredit(_prev: MoneyFormState, formData: FormData): Promise<MoneyFormState> {
  const friendId = String(formData.get("friendId") ?? "");
  const amount = parseDollars(String(formData.get("amount") ?? ""));
  const note = String(formData.get("note") ?? "").trim();
  if (amount === null || amount <= 0) return { error: "Amount: enter a credit amount, e.g. 5.00." };

  const { host, db } = await requireHost(`/app/friends/${friendId}`);
  try {
    await appendLedgerEvent(db, host.id, { friendId, type: "credit", amount, ...(note ? { note } : {}), createdBy: "host" });
    await refreshPaymentRequests(db, host.id, [friendId]);
  } catch (error) {
    console.error("[addCredit]", error);
    return { error: "Could not add this credit. Try again." };
  }
  revalidateFriend(friendId);
  return { ok: true };
}

export async function resolveClaim(_prev: MoneyFormState, formData: FormData): Promise<MoneyFormState> {
  const claimId = String(formData.get("claimId") ?? "");
  const friendId = String(formData.get("friendId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const correction = String(formData.get("amount") ?? "").trim();

  const { host, db } = await requireHost("/app/inbox");
  try {
    if (decision === "reject") {
      await rejectPaymentClaim(db, claimId);
    } else if (decision === "confirm") {
      let amount: number | undefined;
      if (correction !== "") {
        const parsed = parseDollars(correction);
        if (parsed === null || parsed <= 0) return { error: "Amount: enter the amount actually received, or leave it blank." };
        amount = parsed;
      }
      await confirmPaymentClaim(db, claimId, amount);
      await refreshPaymentRequests(db, host.id, [friendId]);
    } else {
      return { error: "Choose confirm or reject." };
    }
  } catch (error) {
    console.error("[resolveClaim]", error);
    return { error: "Could not update this claim. It may already be resolved." };
  }
  revalidateFriend(friendId);
  return { ok: true };
}
