import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Empty, Loading, PageIntro, Section, Statement } from "@/app/_ui";
import { getRecurring, listFriends, listRecurringRuns } from "@/server/db";
import { listChats } from "@/server/telegram/db";

import { PauseResumeForm, RecurringForm } from "../../_components/recurring-form";
import { formatDateTime, money, plural } from "../../_lib/format";
import { requireHost } from "../../_lib/host";
import { describeSchedule } from "../../_lib/recurring-format";

async function RecurringDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { host, db } = await requireHost(`/app/recurring/${id}`);
  const expense = await getRecurring(db, host.id, id);
  if (!expense) notFound();
  const [friends, chats, runs] = await Promise.all([listFriends(db, host.id), listChats(db, host.id), listRecurringRuns(db, host.id, id)]);

  return (
    <div className="space-y-16">
      <PageIntro label="Recurring" title={expense.title}>
        {describeSchedule(expense.cadence, expense.anchorDay)}.{" "}
        {expense.active ? (expense.nextRunAt ? `Next charge ${formatDateTime(expense.nextRunAt)}.` : "Active.") : "Paused."}
      </PageIntro>
      <Statement label="Each time">{money(expense.amount)}</Statement>

      <Section title={expense.active ? "Pause" : "Resume"}>
        <PauseResumeForm expense={expense} />
      </Section>

      <Section title="Edit">
        <RecurringForm hostId={host.id} friends={friends} chats={chats} expense={expense} />
      </Section>

      <Section title="Past charges" meta={runs.length > 0 ? plural(runs.length, "run") : undefined}>
        {runs.length === 0 ? (
          <Empty>No charges yet. Once it runs, each charge is listed here and on every friend’s page as a receipt.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-4 py-3">
                <span className="text-ink">{run.periodKey}</span>
                <span className="label">{formatDateTime(run.ranAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {runs.length > 0 ? <p className="text-sm text-ink-mute">Expenses that have run cannot be deleted; pause them instead.</p> : null}
      </Section>
    </div>
  );
}

export default function RecurringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <RecurringDetail params={params} />
    </Suspense>
  );
}
