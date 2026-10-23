import "server-only";

import { createClient } from "@/lib/supabase/server";

/** The signed-in host. `id` is the `auth.users` id every table's `host_id` references. */
export interface Host {
  readonly id: string;
  readonly email: string | null;
}

/**
 * Resolves the signed-in host from the request cookies, or `null`. Uses
 * `getUser()` so the token is validated against Auth, not just decoded; the
 * proxy already refreshed it. Call this in every handler that touches host
 * data, even though the proxy also blocks unauthenticated requests.
 */
export async function getHost(): Promise<Host | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
