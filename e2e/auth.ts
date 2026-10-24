import type { Page } from "@playwright/test";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Test-only sign-in. The app only offers Google OAuth, which cannot be driven
 * headlessly, so the host is created through the Supabase admin API and a
 * session is minted directly: `generateLink` yields a one-time token that is
 * verified with the same cookie-backed client the app uses, and the resulting
 * cookies are planted in the browser context. No email is sent or read.
 */
export function adminClient() {
  return admin();
}

function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
}

function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for e2e sign-in (see .env.local)");
  return createClient(supabaseUrl(), key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function signInAsNewHost(page: Page, baseURL: string): Promise<{ email: string; userId: string }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const client = admin();
  const created = await client.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for e2e sign-in (see .env.local)");
  const jar = new Map<string, { value: string; options: CookieOptions }>();
  const session = createServerClient(supabaseUrl(), anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => jar.set(name, { value, options })),
    },
  });
  const verified = await session.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  if (verified.error) throw verified.error;

  const origin = new URL(baseURL);
  await page.context().addCookies(
    [...jar]
      .filter(([, { options }]) => (options.maxAge ?? 1) > 0)
      .map(([name, { value, options }]) => ({
        name,
        value,
        domain: origin.hostname,
        path: options.path ?? "/",
        httpOnly: options.httpOnly ?? false,
        secure: options.secure ?? false,
        sameSite: "Lax" as const,
      })),
  );
  await page.goto(`${baseURL}/app`);
  return { email, userId: created.data.user.id };
}
