/** Parses a dollars string ("12.50", "$12.5", "12") into integer cents; null when invalid. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[\s$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Renders cents as a plain dollars string for inputs ("12.50"). */
export function toDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
