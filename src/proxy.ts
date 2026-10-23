import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // The host app lives under /app. Redirecting here (not in the root page)
  // keeps Next's dev prerender validation from rendering a page that only redirects.
  if (request.nextUrl.pathname === "/") return NextResponse.redirect(new URL("/app", request.url));
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
