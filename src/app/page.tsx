import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

/**
 * The host app lives under /app; `src/proxy.ts` redirects `/` there before
 * this renders. Kept as a fallback for requests the proxy does not match. The
 * redirect runs at request time inside a Suspense boundary (like the /app
 * routes) so neither the build nor Next's dev prerender validation evaluates it.
 */
async function Redirect() {
  await connection();
  redirect("/app");
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  );
}
