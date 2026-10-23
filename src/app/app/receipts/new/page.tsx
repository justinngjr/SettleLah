import { Suspense } from "react";

import { Loading } from "@/app/_ui";
import { listFriends } from "@/server/db";

import { ReceiptFlow } from "../../_components/receipt/receipt-flow";
import { requireOnboardedHost } from "../../_lib/host";

async function NewReceipt() {
  const { host, db, profile } = await requireOnboardedHost("/app/receipts/new");
  const friends = await listFriends(db, host.id);
  return (
    <ReceiptFlow hostId={host.id} hostName={profile.displayName} friends={friends.map((f) => ({ id: f.id, name: f.displayName }))} />
  );
}

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewReceipt />
    </Suspense>
  );
}
