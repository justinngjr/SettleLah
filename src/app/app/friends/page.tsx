import Link from "next/link";
import { Suspense } from "react";

import { Empty, Loading, PageIntro, Section } from "@/app/_ui";
import { listFriends } from "@/server/db";

import { AddFriendForm, ArchivedToggle, FriendRowActions, TelegramStatus } from "../_components/friend-forms";
import { requireHost } from "../_lib/host";

async function FriendsList() {
  const { host, db } = await requireHost("/app/friends");
  const all = await listFriends(db, host.id, { includeArchived: true });
  const active = all.filter((f) => !f.archived);
  const archived = all.filter((f) => f.archived);

  return (
    <>
      <Section title="Friends" meta={`${active.length}`}>
        {active.length === 0 ? (
          <Empty>No friends yet. Add the people you usually pay for; you can link them to Telegram later.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((friend) => (
              <li key={friend.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="flex flex-wrap items-baseline gap-4">
                  <Link href={`/app/friends/${friend.id}`} className="text-ink underline-offset-4 hover:underline">
                    {friend.displayName}
                  </Link>
                  <TelegramStatus friend={friend} />
                </div>
                <FriendRowActions friend={friend} />
              </li>
            ))}
          </ul>
        )}
        <ArchivedToggle friends={archived} />
      </Section>
    </>
  );
}

export default function FriendsPage() {
  return (
    <div className="space-y-16">
      <PageIntro label="Friends" title="Friends">
        People you front money for. Names only; Telegram linking happens through the bot.
      </PageIntro>
      <Section title="Add a friend">
        <AddFriendForm />
      </Section>
      <Suspense fallback={<Loading />}>
        <FriendsList />
      </Suspense>
    </div>
  );
}
