import "server-only";

import type { PayNowProxyType } from "@/domain";

import type { DbClient } from "./client";
import type { Tables, TablesUpdate } from "./database.types";
import { unwrap, unwrapRequired } from "./errors";

export type ProfileRow = Tables<"profiles">;

/** The host's own profile; `id = auth.uid()`. PayNow fields feed `buildPayNowPayload`. */
export interface Profile {
  readonly id: string;
  readonly displayName: string | null;
  readonly paynowProxyType: PayNowProxyType | null;
  readonly paynowProxyValue: string | null;
  readonly paynowDisplayName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfilePatch {
  readonly displayName?: string | null;
  /** `null` clears both proxy columns (they must be set or unset together). */
  readonly paynow?: { readonly proxyType: PayNowProxyType; readonly proxyValue: string } | null;
  readonly paynowDisplayName?: string | null;
}

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    paynowProxyType: row.paynow_proxy_type,
    paynowProxyValue: row.paynow_proxy_value,
    paynowDisplayName: row.paynow_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A profile with everything onboarding requires filled in. */
export interface CompleteProfile extends Profile {
  readonly displayName: string;
  readonly paynowProxyType: PayNowProxyType;
  readonly paynowProxyValue: string;
  readonly paynowDisplayName: string;
}

/** Onboarding is complete once the host has a display name and a PayNow proxy. */
export function isProfileComplete(profile: Profile | null): profile is CompleteProfile {
  return (
    profile !== null &&
    !!profile.displayName &&
    profile.paynowProxyType !== null &&
    !!profile.paynowProxyValue &&
    !!profile.paynowDisplayName
  );
}

export async function getProfile(db: DbClient, hostId: string): Promise<Profile | null> {
  const row = unwrap(await db.from("profiles").select("*").eq("id", hostId).maybeSingle(), "getProfile");
  return row === null ? null : toProfile(row);
}

/**
 * Writes the host's profile, creating the row when it is missing.
 *
 * `handle_new_user` creates the profile at sign-up, but an auth user that
 * predates the trigger (or was created while the schema was being applied) has
 * no row. Onboarding is the only path that calls this, and it can only upsert,
 * so a plain UPDATE left such a host stuck on "Could not save your profile"
 * (PostgREST PGRST116: the result contains 0 rows). Upserting on the primary
 * key heals the row instead of dead-ending.
 */
export async function updateProfile(db: DbClient, hostId: string, patch: ProfilePatch): Promise<Profile> {
  const fields: TablesUpdate<"profiles"> = {};
  if (patch.displayName !== undefined) fields.display_name = patch.displayName;
  if (patch.paynowDisplayName !== undefined) fields.paynow_display_name = patch.paynowDisplayName;
  if (patch.paynow !== undefined) {
    fields.paynow_proxy_type = patch.paynow?.proxyType ?? null;
    fields.paynow_proxy_value = patch.paynow?.proxyValue ?? null;
  }
  const row = unwrapRequired(
    await db.from("profiles").upsert({ id: hostId, ...fields }, { onConflict: "id" }).select("*").single(),
    "updateProfile",
  );
  return toProfile(row);
}
