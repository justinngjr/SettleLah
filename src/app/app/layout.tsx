import { Suspense } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppNav } from "./_components/nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-0 sm:flex-nowrap sm:gap-x-16">
            <Link href="/app" className="shrink-0 py-3 text-base tracking-tight text-ink no-underline">
              SettleLah
            </Link>
            <div className="w-full sm:w-auto">
              <Suspense fallback={null}>
            <AppNav />
          </Suspense>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-10 sm:px-8 sm:pt-16">
        <div className="max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
