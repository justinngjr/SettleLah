import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

import type { Database } from "./database.types";

/** Typed Supabase client. Repository functions take one of these so tests can pass a mock. */
export type DbClient = SupabaseClient<Database>;

/**
 * Client acting as the signed-in host (RLS applies). For Server Components,
 * Server Actions and Route Handlers.
 */
export async function createDbClient(): Promise<DbClient> {
  return createClient();
}

/**
 * Client acting as the service role (RLS bypassed). Only for trusted
 * server-side workers: the Telegram bot, inbound webhooks and cron. Never
 * use it in a request handler that acts on behalf of a browser session.
 */
export function createServiceClient(): DbClient {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server-only; see .env.example).");
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
