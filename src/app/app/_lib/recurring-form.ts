import { fromDollars, type RecurringParticipant } from "@/domain";
import type { NewRecurringExpense } from "@/server/db/recurring";

function readInt(value: FormDataEntryValue | null, fallback: number): number {
  const text = String(value ?? "").trim();
  if (text === "") return fallback;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : fallback;
}

/** Recurring form -> repository input (dollars via `fromDollars`). Validation of ranges and ownership happens in the repository. */
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
