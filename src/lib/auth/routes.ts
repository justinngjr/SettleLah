/**
 * Route protection rules shared by the proxy and request handlers. Pure
 * module: no Next.js or Supabase imports, so it can be unit-tested and used
 * from `src/proxy.ts`.
 */

/** Auth pages/handlers that must stay reachable while signed out. */
export const AUTH_ROUTES: readonly string[] = ["/login", "/auth/callback", "/auth/signout"];

/**
 * The ONLY place to open an `/api/*` route to unauthenticated callers. Later
 * sessions add their public webhooks here (e.g. `/api/telegram/webhook`,
 * `/api/inbound-email`), which must then verify their own secret. Everything
 * else under `/api` requires a signed-in host.
 */
export const PUBLIC_API_ROUTES: readonly string[] = ["/api/inbound-email", "/api/telegram/webhook", "/api/cron/reminders", "/api/cron/recurring"];

function matches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => matches(pathname, route));
}

export function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some((route) => matches(pathname, route));
}

export function isApiRoute(pathname: string): boolean {
  return matches(pathname, "/api");
}

/** Everything under `/app` and every non-allowlisted `/api/*` route needs a host session. */
export function requiresHost(pathname: string): boolean {
  if (isAuthRoute(pathname)) return false;
  if (matches(pathname, "/app")) return true;
  if (isApiRoute(pathname)) return !isPublicApiRoute(pathname);
  return false;
}

/**
 * Only same-origin relative paths are valid post-login destinations; anything
 * else (absolute URLs, protocol-relative `//evil`) falls back to `/app`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
