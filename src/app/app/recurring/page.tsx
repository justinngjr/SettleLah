import Link from "next/link";
import { Suspense } from "react";

import { ButtonLink, Empty, Loading, PageIntro, Section } from "@/app/_ui";
import { listFriends, listRecurring } from "@/server/db";

import { formatDateTime, money, plural } from "../_lib/format";
import { requireHost } from "../_lib/host";
import { describeParticipants, describeSchedule } from "../_lib/recurring-format";

async function RecurringList() {
  const { host, db } = await requireHost("/app/recurring");
  const [expenses, friends] = await Promise.all([listRecurring(db, host.id), listFriends(db, host.id, { includeArchived: true })]);
  const nameOf = (id: string) => friends.find((f) => f.id === id)?.displayName;
  const active = expenses.filter((e) => e.active);
  const paused = expenses.filter((e) => !e.active);

  if (expenses.length === 0) {
    return (
      <Section title="Recurring expenses">
        <Empty action={<ButtonLink href="/app/recurring/new">Add a recurring expense</ButtonLink>}>
          Nothing repeats yet. A recurring expense is a split that runs on a schedule: each friend’s share goes on their balance, and
          anyone short is asked to top up.
        </Empty>
      </Section>
    );
  }

  const rows = (list: typeof expenses) => (
    <ul className="divide-y divide-line">
      {list.map((e) => (
        <li key={e.id} className="py-5">
          <Link href={`/app/recurring/${e.id}`} className="block space-y-2 underline-offset-4 hover:underline">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <span className="text-ink">{e.title}</span>
              <span className="amount">{money(e.amount)}</span>
            </div>
            <p className="text-sm text-ink-soft">
              {describeSchedule(e.cadence, e.anchorDay)} · {describeParticipants(e.participants.map((p) => p.id), host.id, nameOf)}
            </p>
            <p className="label">
              {e.active ? (e.nextRunAt ? `Next ${formatDateTime(e.nextRunAt)}` : "Active") : "Paused"}
              {e.telegramChatId !== null ? " · posts to Telegram" : ""}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <Section title="Active" meta={plural(active.length, "expense")}>
        {active.length === 0 ? <Empty>Everything is paused.</Empty> : rows(active)}
      </Section>
      {paused.length > 0 ? (
        <Section title="Paused" meta={plural(paused.length, "expense")}>
          {rows(paused)}
        </Section>
      ) : null}
    </>
  );
}

export default function RecurringPage() {
  return (
    <div className="space-y-16">
      <PageIntro label="Recurring" title="Recurring expenses">
        Shared subscriptions and standing bills. Each run is an ordinary split: friends’ shares land on their balances and credit
        is used first.
      </PageIntro>
      <ButtonLink href="/app/recurring/new">Add a recurring expense</ButtonLink>
      <Suspense fallback={<Loading />}>
        <RecurringList />
      </Suspense>
    </div>
  );
}
