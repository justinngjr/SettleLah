import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, Empty, Loading, Section, Statement } from "@/app/_ui";
import { listBalances, listPendingClaims } from "@/server/db";

import { money, plural } from "./_lib/format";
import { requireOnboardedHost } from "./_lib/host";

async function HomeContent() {
  const { host, db, profile } = await requireOnboardedHost("/app");
  const [balances, pending] = await Promise.all([listBalances(db, host.id), listPendingClaims(db, host.id)]);

  const owed = balances.filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const credits = balances.filter((b) => b.balance < 0);
  const totalOwed = owed.reduce((sum, b) => sum + b.balance, 0);

  return (
    <div className="space-y-16">
      <header className="space-y-8">
        <Statement label={`Owed to you, ${profile.displayName}`}>{money(totalOwed)}</Statement>
        <p className="measure text-ink-soft">
          {owed.length === 0
            ? "Nobody owes you anything right now."
            : `${plural(owed.length, "friend")} with an outstanding balance.`}
          {pending.length > 0 ? (
            <>
              {" "}
              <Link href="/app/inbox" className="text-ink underline underline-offset-4">
                {plural(pending.length, "payment")} waiting for your confirmation
              </Link>
              .
            </>
          ) : null}
        </p>
        <ButtonLink href="/app/receipts/new">Log a receipt</ButtonLink>
      </header>

      <Section title="Outstanding" meta={owed.length > 0 ? plural(owed.length, "friend") : undefined}>
        {owed.length === 0 ? (
          <Empty action={<ButtonLink href="/app/receipts/new" variant="secondary">Log a receipt</ButtonLink>}>
            Log a receipt and the people who owe you will show up here, with a PayNow QR for each.
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {owed.map(({ friend, balance }) => (
              <li key={friend.id}>
                <Link href={`/app/friends/${friend.id}`} className="flex items-baseline justify-between gap-6 py-4 no-underline">
                  <span className="text-ink">
                    {friend.displayName}
                    {friend.archived ? <span className="label ml-3">Archived</span> : null}
                  </span>
                  <span className="amount">{money(balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {credits.length > 0 ? (
        <Section title="Holding credit" meta={plural(credits.length, "friend")}>
          <ul className="divide-y divide-line">
            {credits.map(({ friend, balance }) => (
              <li key={friend.id}>
                <Link href={`/app/friends/${friend.id}`} className="flex items-baseline justify-between gap-6 py-4 no-underline">
                  <span className="text-ink">{friend.displayName}</span>
                  <span className="amount">{money(-balance)} credit</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <HomeContent />
    </Suspense>
  );
}
