"use server";

import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/routes";
import { updateProfile } from "@/server/db";

import { requireHost } from "../_lib/host";
import { validateProfileForm, type ProfileFormState } from "../_lib/profile-validation";

export async function saveProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const result = validateProfileForm({
    displayName: String(formData.get("displayName") ?? ""),
    paynowProxyType: String(formData.get("paynowProxyType") ?? "mobile"),
    paynowProxyValue: String(formData.get("paynowProxyValue") ?? ""),
    paynowDisplayName: String(formData.get("paynowDisplayName") ?? ""),
  });
  if (!result.ok) return { errors: result.errors };

  const { host, db } = await requireHost("/app/onboarding");
  try {
    await updateProfile(db, host.id, {
      displayName: result.value.displayName,
      paynow: { proxyType: result.value.proxyType, proxyValue: result.value.proxyValue },
      paynowDisplayName: result.value.payeeName,
    });
  } catch (error) {
    console.error("[saveProfile]", error);
    return { errors: { form: "Could not save your profile. Try again." } };
  }

  const next = formData.get("next");
  if (typeof next === "string" && next.length > 0) redirect(safeNextPath(next));
  return { errors: {}, saved: true };
}
