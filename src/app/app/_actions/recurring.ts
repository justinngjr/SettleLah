"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { fromDollars, MoneyError, type RecurringParticipant } from "@/domain";
import { createRecurring, pauseRecurring, RecurringInputError, resumeRecurring, updateRecurring, type NewRecurringExpense } from "@/server/db";

import { requireHost } from "../_lib/host";

export interface RecurringFormState {
  readonly error?: string;
  readonly ok?: boolean;
}

function readInt(value: FormDataEntryValue | null, fallback: number): number {
  const n = Number(String(value ?? ""));
  return Number.isSafeInteger(n) ? n : fallback;
}

/** Form -> repository input. Validation of ranges and ownership happens in the repository. */
export function parseRecurringForm(formData: FormData): NewRecurringExpense {
  const amount = fromDollars(String(formData.get("amount") ?? ""));
  const cadence = String(formData.get("cadence") ?? "monthly") as NewRecurringExpense["cadence"];
  const anchorDay = readInt(formData.get("anchorDay"), NaN);
  const participants: RecurringParticipant[] = [];
  for (const id of formData.getAll("participant").map(String)) {
    participants.push({ id, weight: readInt(formData.get(`weight_${id}`), 1) });
  }
  const chat = String(formData.get("telegramChatId") ?? "").trim();
  return {
    title: String(formData.get("title") ?? ""),
    amount,
    cadence,
    anchorDay,
    participants,
    telegramChatId: chat === "" ? null : Number(chat),
  };
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
