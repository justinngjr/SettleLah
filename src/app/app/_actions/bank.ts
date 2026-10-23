"use server";

import { revalidatePath } from "next/cache";

import { updateReconcileSettings } from "@/server/reconcile";

import { bankProposals } from "../_lib/bank-proposals";
import { requireHost } from "../_lib/host";

export interface BankFormState {
  readonly error?: string;
  readonly ok?: boolean;
  readonly done?: "confirmed" | "reassigned" | "ignored";
}

function revalidateMoney(): void {
  revalidatePath("/app");
  revalidatePath("/app/inbox");
  revalidatePath("/app/friends");
}

/**
 * Confirm / Reassign / Ignore a bank-alert proposal. Reassigning without the
 * "and confirm" flag only re-points the proposal; confirming records the
 * payment (claim + ledger event) against the chosen request.
 */
export async function resolveBankProposal(_prev: BankFormState, formData: FormData): Promise<BankFormState> {
  const proposalId = String(formData.get("proposalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const paymentRequestId = String(formData.get("paymentRequestId") ?? "").trim();
  if (!proposalId) return { error: "This alert could not be found. Refresh the page." };
  const { host, db } = await requireHost("/app/inbox");
  try {
    if (decision === "confirm") {
      await bankProposals.confirm(db, host.id, proposalId, paymentRequestId || null);
      revalidateMoney();
      return { ok: true, done: "confirmed" };
    }
    if (decision === "reassign") {
      if (!paymentRequestId) return { error: "Request: pick the friend and request this payment belongs to." };
      await bankProposals.reassign(db, host.id, proposalId, paymentRequestId);
      revalidatePath("/app/inbox");
      return { ok: true, done: "reassigned" };
    }
    if (decision === "ignore") {
      await bankProposals.ignore(db, host.id, proposalId);
      revalidatePath("/app/inbox");
      return { ok: true, done: "ignored" };
    }
    return { error: "Choose confirm, reassign or ignore." };
  } catch (error) {
    console.error("[resolveBankProposal]", error);
    return { error: "Could not update this alert. It may already be resolved; refresh to check." };
  }
}

export async function setAutoConfirmBankAlerts(formData: FormData): Promise<void> {
  const enabled = formData.get("autoConfirm") === "true";
  const { host, db } = await requireHost("/app/settings");
  await updateReconcileSettings(db, host.id, { autoConfirmBankAlerts: enabled });
  revalidatePath("/app/settings");
}
