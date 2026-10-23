import { Suspense } from "react";

import { safeNextPath } from "@/lib/auth/routes";
import { signInWithEmail } from "@/server/auth/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function LoginForm({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sent = first(params.sent);
  const error = first(params.error);
  const next = safeNextPath(first(params.next));

  if (sent) {
    return (
      <p>
        Check your inbox: we sent a sign-in link to <strong>{sent}</strong>.
      </p>
    );
  }

  return (
    <form action={signInWithEmail}>
      <input type="hidden" name="next" value={next} />
      <label>
        Email
        <input type="email" name="email" required autoComplete="email" />
      </label>
      <button type="submit">Send magic link</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

/** Host sign-in. Friends never sign in; they are reached via Telegram. */
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main>
      <h1>Sign in to SettleLah</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
