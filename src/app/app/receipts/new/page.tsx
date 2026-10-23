import { Suspense } from "react";

import { Loading } from "@/app/_ui";
import { listFriends } from "@/server/db";
import { listChats } from "@/server/telegram/db";

import { ReceiptFlow } from "../../_components/receipt/receipt-flow";
import { requireOnboardedHost } from "../../_lib/host";

async function NewReceipt() {
  const { host, db, profile } = await requireOnboardedHost("/app/receipts/new");
  const [friends, chats] = await Promise.all([listFriends(db, host.id), listChats(db, host.id)]);
  return (
    <ReceiptFlow
      hostId={host.id}
      hostName={profile.displayName}
      friends={friends.map((f) => ({ id: f.id, name: f.displayName }))}
      chats={chats.map((c) => ({ telegramChatId: c.telegramChatId, title: c.title }))}
    />
  );
}

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewReceipt />
    </Suspense>
  );
}
