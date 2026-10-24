import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth landing. Supabase redirects here with a PKCE `code` after Google
 * sign-in; exchanging it sets the session cookies, then we continue to `next`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");

  let message: string | undefined;
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) message = "Sign-in failed";
  } else {
    message = searchParams.get("error_description") ?? "Sign-in failed";
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (message !== undefined) {
    target.pathname = "/login";
    target.searchParams.set("error", message);
    target.searchParams.set("next", next);
  } else {
    target.pathname = next.split("?")[0];
    const query = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
    target.search = query;
  }
  return NextResponse.redirect(target);
}
