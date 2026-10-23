import "server-only";

import { redirect } from "next/navigation";

import { getHost, type Host } from "@/server/auth/session";
import { createDbClient, getProfile, isProfileComplete, type CompleteProfile, type DbClient } from "@/server/db";

export interface HostContext {
  readonly host: Host;
  readonly db: DbClient;
}

/** The signed-in host and an RLS-scoped client, or a redirect to login. */
export async function requireHost(next = "/app"): Promise<HostContext> {
  const host = await getHost();
  if (!host) redirect(`/login?next=${encodeURIComponent(next)}`);
  const db = await createDbClient();
  return { host, db };
}

export interface OnboardedHostContext extends HostContext {
  readonly profile: CompleteProfile;
}

/** Like `requireHost`, but sends hosts without a display name / PayNow proxy to onboarding first. */
export async function requireOnboardedHost(next = "/app"): Promise<OnboardedHostContext> {
  const ctx = await requireHost(next);
  const profile = await getProfile(ctx.db, ctx.host.id);
  if (!isProfileComplete(profile)) redirect(`/app/onboarding?next=${encodeURIComponent(next)}`);
  return { ...ctx, profile };
}
