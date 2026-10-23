import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { requiresHost, isApiRoute } from "@/lib/auth/routes";

import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase session cookies on every matched request (per the
 * @supabase/ssr Next.js guide) and enforces route protection. Must return the
 * `supabaseResponse` it builds (or copy its cookies) so refreshed tokens
 * reach the browser.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getClaims: it can cause
  // random logouts (see the @supabase/ssr docs).
  const { data } = await supabase.auth.getClaims();
  const signedIn = data?.claims !== undefined;

  const { pathname } = request.nextUrl;
  if (!signedIn && requiresHost(pathname)) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: { code: "unauthenticated", message: "sign in required" } }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}
