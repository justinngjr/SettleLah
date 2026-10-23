import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing. Supabase sends either a PKCE `code` or a `token_hash`
 * + `type` pair depending on the email template; both are handled.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();
  let message: string | undefined;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    message = error?.message;
  } else if (tokenHash && (type === "email" || type === "magiclink")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    message = error?.message;
  } else {
    message = "The sign-in link is missing its code.";
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
