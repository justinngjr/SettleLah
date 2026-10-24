"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Starts Google OAuth (PKCE). Supabase sends the browser to Google and back to
 * `/auth/callback?code=...`, which exchanges the code for a session. The host
 * is created on first login (profiles row via trigger).
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    const message = error?.message ?? "Sign-in failed";
    redirect(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
