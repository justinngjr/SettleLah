import { formatSGD, type Cents } from "@/domain";

/** Display-only helpers. Money always comes from the domain's `formatSGD`. */
export const money = (cents: Cents): string => formatSGD(cents);

const DATE = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
const DATE_TIME = new Intl.DateTimeFormat("en-SG", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Singapore",
});

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
