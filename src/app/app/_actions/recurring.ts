"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { MoneyError } from "@/domain";
import { createRecurring, pauseRecurring, RecurringInputError, resumeRecurring, updateRecurring, type NewRecurringExpense } from "@/server/db";

import { requireHost } from "../_lib/host";
import { parseRecurringForm } from "../_lib/recurring-form";

export interface RecurringFormState {
  readonly error?: string;
  readonly ok?: boolean;
}

function explain(error: unknown): string {
  if (error instanceof RecurringInputError) return error.message;
  if (error instanceof MoneyError) return "Amount: enter dollars like 17.90.";
  console.error("[recurring]", error);
  return "Could not save this recurring expense. Try again.";
}

function revalidate(recurringExpenseId?: string): void {
  revalidatePath("/app/recurring");
  if (recurringExpenseId) revalidatePath(`/app/recurring/${recurringExpenseId}`);
}

/** Creates (no `recurringExpenseId`) or edits a recurring expense; creation lands back on the list. */
export async function saveRecurring(_prev: RecurringFormState, formData: FormData): Promise<RecurringFormState> {
  const recurringExpenseId = String(formData.get("recurringExpenseId") ?? "").trim();
  const next = recurringExpenseId ? `/app/recurring/${recurringExpenseId}` : "/app/recurring/new";
  const { host, db } = await requireHost(next);
  let input: NewRecurringExpense;
  try {
    input = parseRecurringForm(formData);
  } catch (error) {
    return { error: explain(error) };
  }
  try {
    if (recurringExpenseId) {
      await updateRecurring(db, host.id, recurringExpenseId, input);
    } else {
      await createRecurring(db, host.id, input);
    }
  } catch (error) {
    return { error: explain(error) };
  }
  revalidate(recurringExpenseId || undefined);
  if (!recurringExpenseId) redirect("/app/recurring");
  return { ok: true };
}

export async function setRecurringActive(formData: FormData): Promise<void> {
  const recurringExpenseId = String(formData.get("recurringExpenseId") ?? "");
  const active = formData.get("active") === "true";
  const { host, db } = await requireHost(`/app/recurring/${recurringExpenseId}`);
  if (active) await resumeRecurring(db, host.id, recurringExpenseId);
  else await pauseRecurring(db, host.id, recurringExpenseId);
  revalidate(recurringExpenseId);
}
