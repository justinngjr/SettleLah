import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Test-only sign-in: create (or reuse) a host through the Supabase admin API,
 * generate a magic link and open it, exactly like a user clicking the email,
 * without reading the Mailpit inbox.
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for e2e sign-in (see .env.local)");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function signInAsNewHost(page: Page, baseURL: string): Promise<{ email: string; userId: string }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const client = admin();
  const created = await client.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await client.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${baseURL}/auth/callback?next=/app` },
  });
  if (link.error) throw link.error;
  const { hashed_token } = link.data.properties;
  // Same route the emailed link hits; token_hash + type are what the callback verifies.
  await page.goto(`${baseURL}/auth/callback?token_hash=${hashed_token}&type=magiclink&next=/app`);
  return { email, userId: created.data.user.id };
}
