import { Suspense } from "react";

import { Loading, PageIntro, Section } from "@/app/_ui";
import { listFriends } from "@/server/db";
import { listChats } from "@/server/telegram/db";

import { RecurringForm } from "../../_components/recurring-form";
import { requireHost } from "../../_lib/host";

async function NewRecurringForm() {
  const { host, db } = await requireHost("/app/recurring/new");
  const [friends, chats] = await Promise.all([listFriends(db, host.id), listChats(db, host.id)]);
  return <RecurringForm hostId={host.id} friends={friends} chats={chats} />;
}

export default function NewRecurringPage() {
  return (
    <div className="space-y-16">
      <PageIntro label="Recurring" title="New recurring expense">
        One amount, split on a schedule. The first charge is the next matching day from today.
      </PageIntro>
      <Section>
        <Suspense fallback={<Loading />}>
          <NewRecurringForm />
        </Suspense>
      </Section>
    </div>
  );
}
