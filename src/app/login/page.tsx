import { Suspense } from "react";

import { Button, Notice } from "@/app/_ui";
import { safeNextPath } from "@/lib/auth/routes";
import { signInWithGoogle } from "@/server/auth/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" focusable="false">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3a7.2 7.2 0 0 1-10.72-3.78H1.33v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.34 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.33a12 12 0 0 0 0 10.8l4.01-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 1.33 6.6l4.01 3.1A7.17 7.17 0 0 1 12 4.77Z"
      />
    </svg>
  );
}

async function LoginForm({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = first(params.error);
  const next = safeNextPath(first(params.next));

  return (
    <form action={signInWithGoogle} className="space-y-8">
      <input type="hidden" name="next" value={next} />
      {error ? <Notice role="alert">{error}</Notice> : null}
      <Button type="submit" className="w-full sm:w-auto">
        <GoogleMark />
        Continue with Google
      </Button>
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
            Only the host signs in, with their Google account. There is no password.
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
