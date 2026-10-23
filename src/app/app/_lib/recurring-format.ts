import type { RecurringCadence } from "@/domain";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** "Monthly on the 1st" / "Weekly on Monday". Monthly anchors past a short month fall on its last day. */
export function describeSchedule(cadence: RecurringCadence, anchorDay: number): string {
  if (cadence === "weekly") return `Weekly on ${WEEKDAYS[anchorDay] ?? "?"}`;
  return anchorDay > 28 ? `Monthly on the ${ordinal(anchorDay)} (or the last day)` : `Monthly on the ${ordinal(anchorDay)}`;
}

/** "You, Sarah and Ben" from participant ids; unknown ids (archived or removed friends) are named as such. */
export function describeParticipants(ids: readonly string[], hostId: string, nameOf: (id: string) => string | undefined): string {
  const names = ids.map((id) => (id === hostId ? "You" : (nameOf(id) ?? "a removed friend")));
  if (names.length <= 1) return names[0] ?? "Nobody";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
