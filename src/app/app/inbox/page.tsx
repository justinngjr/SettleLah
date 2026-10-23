import { Suspense } from "react";

import { Empty, Loading, PageIntro, Section } from "@/app/_ui";
import { listFriends, listPaymentRequests, listPendingClaims } from "@/server/db";

import { ClaimForm, type ClaimView } from "../_components/claim-form";
import { bankProposals } from "../_lib/bank-proposals";
import { formatDateTime, money, plural } from "../_lib/format";
import { requireHost } from "../_lib/host";

async function InboxContent() {
  const { host, db } = await requireHost("/app/inbox");
  const [claims, requests, friends, proposals] = await Promise.all([
    listPendingClaims(db, host.id),
    listPaymentRequests(db, host.id),
    listFriends(db, host.id, { includeArchived: true }),
    bankProposals.list(host.id),
  ]);
  const requestById = new Map(requests.map((r) => [r.id, r]));
  const friendById = new Map(friends.map((f) => [f.id, f]));

  const views: ClaimView[] = claims.flatMap((claim) => {
    const request = requestById.get(claim.paymentRequestId);
    if (!request) return [];
    const friend = friendById.get(request.friendId);
    return [
      {
        id: claim.id,
        friendId: request.friendId,
        friendName: friend?.displayName ?? "A friend",
        reference: request.reference,
        requestAmount: request.amount,
        claimedAmount: claim.amount,
        claimedAt: claim.claimedAt,
        source: claim.source,
      },
    ];
  });

  return (
    <div className="space-y-16">
      <Section title="Marked as paid" meta={views.length > 0 ? plural(views.length, "claim") : undefined}>
        {views.length === 0 ? (
          <Empty>Nothing waiting. When a friend taps “I paid” in Telegram, it shows up here for you to confirm.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {views.map((claim) => (
              <li key={claim.id}>
                <ClaimForm
                  claim={claim}
                  amountLabel={money(claim.claimedAmount ?? claim.requestAmount)}
                  claimedAtLabel={formatDateTime(claim.claimedAt)}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Bank alerts" meta={proposals.length > 0 ? plural(proposals.length, "match") : undefined}>
        {proposals.length === 0 ? (
          <Empty>No bank-alert matches. Once bank emails are connected, likely matches appear here to confirm, reassign or ignore.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-4">
                <span>
                  {p.payerName ?? p.bank} → {p.proposedFriendName ?? "unassigned"}
                </span>
                <span className="amount">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function InboxPage() {
  return (
    <div className="space-y-16">
      <PageIntro label="Inbox" title="Inbox">
        Payments waiting for your confirmation. Nothing changes a balance until you say so.
      </PageIntro>
      <Suspense fallback={<Loading />}>
        <InboxContent />
      </Suspense>
    </div>
  );
}
