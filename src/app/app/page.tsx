import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/server/auth/actions";
import { getHost } from "@/server/auth/session";

async function SignedIn() {
  const host = await getHost();
  if (!host) redirect("/login?next=/app");
  return (
    <>
      <p>Signed in as {host.email ?? host.id}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}

/** Placeholder host area; the real UI is a later session. The proxy already requires a session here. */
export default function AppPage() {
  return (
    <main>
      <h1>SettleLah</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <SignedIn />
      </Suspense>
    </main>
  );
}
