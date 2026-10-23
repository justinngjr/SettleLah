import { normaliseSgMobile, normaliseUen, PayNowError, sanitisePayeeName, type PayNowProxyType } from "@/domain";

export interface ProfileFormState {
  readonly errors: Partial<Record<"displayName" | "paynowProxyValue" | "paynowDisplayName" | "form", string>>;
  readonly saved?: boolean;
}

export const EMPTY_PROFILE_STATE: ProfileFormState = { errors: {} };

/** Pure validation, shared with tests. Uses the domain PayNow helpers so what we store is what the QR encodes. */
export function validateProfileForm(input: {
  displayName: string;
  paynowProxyType: string;
  paynowProxyValue: string;
  paynowDisplayName: string;
}):
  | { ok: true; value: { displayName: string; proxyType: PayNowProxyType; proxyValue: string; payeeName: string } }
  | { ok: false; errors: ProfileFormState["errors"] } {
  const errors: Record<string, string> = {};
  const displayName = input.displayName.trim();
  if (displayName.length === 0) errors.displayName = "Display name: enter the name your friends know you by.";

  const proxyType: PayNowProxyType = input.paynowProxyType === "uen" ? "uen" : "mobile";
  let proxyValue = "";
  try {
    proxyValue = proxyType === "mobile" ? normaliseSgMobile(input.paynowProxyValue) : normaliseUen(input.paynowProxyValue);
  } catch (error) {
    errors.paynowProxyValue =
      proxyType === "mobile"
        ? "PayNow mobile: enter a Singapore mobile number (8 digits starting with 8 or 9)."
        : "PayNow UEN: enter 8-10 letters and digits.";
    if (!(error instanceof PayNowError)) throw error;
  }

  let payeeName = "";
  try {
    payeeName = sanitisePayeeName(input.paynowDisplayName);
  } catch (error) {
    errors.paynowDisplayName = "Payee name: enter the name your bank shows to payers (letters and digits).";
    if (!(error instanceof PayNowError)) throw error;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName, proxyType, proxyValue, payeeName } };
}
