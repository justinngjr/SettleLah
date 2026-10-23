import { redirect } from "next/navigation";
import { connection } from "next/server";

/**
 * The host app lives under /app; `src/proxy.ts` redirects `/` there before
 * this renders. Kept as a fallback for requests the proxy does not match, and
 * opted out of prerendering (like the /app routes) so the redirect is not
 * evaluated at build or dev-validation time.
 */
export default async function Home() {
  await connection();
  redirect("/app");
}
