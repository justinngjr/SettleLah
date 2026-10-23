import { Suspense } from "react";

import { Empty, Loading, PageIntro, Section } from "@/app/_ui";
import { listFriends, listPaymentRequests, listPendingClaims } from "@/server/db";
import { getHostProfile, listPendingBindingRows } from "@/server/telegram/db";

import { BankProposalForm, type BankProposalView, type RequestOption } from "../_components/bank-proposal";
import { ClaimForm, type ClaimView } from "../_components/claim-form";
import { BindingRequestForm, type BindingView } from "../_components/telegram-forms";
import { bankProposals, describeMatchReason } from "../_lib/bank-proposals";
import { formatDateTime, money, plural } from "../_lib/format";
import { requireHost } from "../_lib/host";

async function InboxContent() {
  const { host, db } = await requireHost("/app/inbox");
  const [claims, requests, friends, proposals, bindings, profile] = await Promise.all([
    listPendingClaims(db, host.id),
    listPaymentRequests(db, host.id),
    listFriends(db, host.id, { includeArchived: true }),
    bankProposals.list(db, host.id),
    listPendingBindingRows(db, host.id),
    getHostProfile(db, host.id),
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

  const openRequests: RequestOption[] = requests
    .filter((r) => r.status === "open")
    .map((r) => ({
      id: r.id,
      friendId: r.friendId,
      friendName: friendById.get(r.friendId)?.displayName ?? "A friend",
      amountLabel: money(r.amount),
      reference: r.reference,
    }))
    .sort((a, b) => a.friendName.localeCompare(b.friendName));

  const proposalViews: BankProposalView[] = proposals.map((p) => ({
    id: p.id,
    bank: p.bank,
    amountLabel: money(p.amount),
    payerName: p.payerName,
    reference: p.reference,
    receivedAtLabel: formatDateTime(p.receivedAt),
    proposedFriendId: p.proposedFriendId,
    proposedFriendName: p.proposedFriendName,
    proposedPaymentRequestId: p.proposedPaymentRequestId,
    proposedRequestReference: p.proposedRequestReference,
    confidence: p.confidence,
    reasonLabel: describeMatchReason(p.reason),
  }));

  const bindingViews: BindingView[] = bindings.map((b) => ({
    id: b.id,
    friendName: friendById.get(b.friendId)?.displayName ?? "a friend",
    telegramUsername: b.telegramUsername,
    telegramFirstName: b.telegramFirstName,
    viaPrivateChat: b.viaPrivateChat,
    createdAtLabel: formatDateTime(b.createdAt),
  }));
  const hostLinked = profile?.telegramUserId !== null && profile?.telegramUserId !== undefined;
  const showBindings = !hostLinked || bindingViews.length > 0;

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

      <Section title="Bank alerts" meta={proposalViews.length > 0 ? plural(proposalViews.length, "alert") : undefined}>
        {proposalViews.length === 0 ? (
          <Empty>No bank alerts waiting. Forward your DBS/POSB alerts (Settings › Bank alerts) and likely matches appear here to confirm, reassign or ignore.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {proposalViews.map((p) => (
              <li key={p.id}>
                <BankProposalForm proposal={p} requests={openRequests} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {showBindings ? (
        <Section title="Telegram link requests" meta={bindingViews.length > 0 ? plural(bindingViews.length, "request") : undefined}>
          {bindingViews.length === 0 ? (
            <Empty>
              None waiting. When a friend tells the bot who they are, you approve it here
              {hostLinked ? "" : " (or in Telegram, once you connect your own account in Settings)"}.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {bindingViews.map((b) => (
                <li key={b.id}>
                  <BindingRequestForm binding={b} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
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
