import { Suspense } from "react";

import { Button, Field, Notice } from "@/app/_ui";
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
      <div className="space-y-8">
        <p className="measure text-ink-soft">
          We sent a sign-in link to <span className="text-ink">{sent}</span>. Open it on this device to continue.
        </p>
        <a href="/login" className="text-ink underline underline-offset-4">
          Use a different email
        </a>
      </div>
    );
  }

  return (
    <form action={signInWithEmail} className="space-y-8">
      <input type="hidden" name="next" value={next} />
      <Field
        label="Email"
        type="email"
        name="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        error={error ?? null}
      />
      <Button type="submit">Send magic link</Button>
    </form>
  );
}

/** Host sign-in. Friends never sign in; they are reached via Telegram. */
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-16 sm:px-8 sm:pt-24">
      <div className="max-w-md space-y-16">
        <header className="space-y-8">
          <p className="label">SettleLah</p>
          <h1 className="statement">Sign in</h1>
          <p className="measure text-ink-soft">
            Only the host signs in. We email you a link; there is no password.
          </p>
        </header>
        <Suspense fallback={<p className="text-sm text-ink-mute">Loading…</p>}>
          <LoginForm searchParams={searchParams} />
        </Suspense>
        <Notice>Friends never need an account. They pay you by scanning a PayNow QR.</Notice>
      </div>
    </main>
  );
}
