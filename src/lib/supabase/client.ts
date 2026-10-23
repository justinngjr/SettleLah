import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/server/db/database.types";

import { getSupabaseEnv } from "./env";

/** Supabase client for Client Components (runs in the browser). */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
