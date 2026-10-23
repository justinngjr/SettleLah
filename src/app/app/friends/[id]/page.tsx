import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Empty, Loading, PageIntro, Row, Rows, Section, Statement } from "@/app/_ui";
import { creditOf, outstandingRequest } from "@/domain";
import { getFriend, listLedgerHistory, listPaymentRequests, listReceiptsById, loadLedger, type LedgerHistoryEntry } from "@/server/db";

import { AddCreditForm, RecordPaymentForm } from "../../_components/friend-money-forms";
import { TelegramStatus } from "../../_components/friend-forms";
import { PayNowQr } from "../../_components/paynow-qr";
import { formatDateTime, money } from "../../_lib/format";
import { requireOnboardedHost } from "../../_lib/host";

const EVENT_LABEL: Record<LedgerHistoryEntry["type"], string> = {
  expense_share: "Share of",
  payment: "Payment",
  credit: "Credit",
  friend_fronted: "They paid for",
};

function sign(entry: LedgerHistoryEntry): string {
  return entry.type === "expense_share" ? "+" : "−";
}

async function FriendDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: friendId } = await params;
  const { host, db, profile } = await requireOnboardedHost(`/app/friends/${friendId}`);
  const friend = await getFriend(db, host.id, friendId);
  if (!friend) notFound();

  const [ledger, history, openRequests] = await Promise.all([
    loadLedger(db, host.id, friendId),
    listLedgerHistory(db, host.id, friendId),
    listPaymentRequests(db, host.id, { friendId, status: "open" }),
  ]);
  const outstanding = outstandingRequest(ledger, friendId);
  const credit = creditOf(ledger, friendId);
  const request = openRequests[0] ?? null;
  const receiptIds = history.flatMap((e) => (e.receiptId ? [e.receiptId] : []));
  const receipts = await listReceiptsById(db, host.id, receiptIds);
  const receiptById = new Map(receipts.map((r) => [r.id, r]));

  return (
    <div className="space-y-16">
      <PageIntro label="Friend" title={friend.displayName}>
        <TelegramStatus friend={friend} />
        {friend.archived ? <p className="mt-3">Archived. Their history stays; they no longer appear when logging receipts.</p> : null}
      </PageIntro>

      <Statement label={credit > 0 ? "Credit they hold" : "They owe you"}>{money(credit > 0 ? credit : outstanding)}</Statement>

      {outstanding > 0 ? (
        <Section title="Pay by PayNow">
          {request ? (
            <div className="grid gap-10 md:grid-cols-[auto_1fr] md:items-start">
              <PayNowQr
                proxyType={profile.paynowProxyType}
                proxyValue={profile.paynowProxyValue}
                payeeName={profile.paynowDisplayName}
                amount={request.amount}
                reference={request.reference}
                friendName={friend.displayName}
              />
              <Rows>
                <Row term="Amount">{money(request.amount)}</Row>
                <Row term="Reference">{request.reference}</Row>
                <Row term="To">{profile.paynowDisplayName}</Row>
                <Row term="Requested">{formatDateTime(request.createdAt)}</Row>
              </Rows>
            </div>
          ) : (
            <Empty>
              No open request yet. One is created when you confirm a receipt; recording a payment below also refreshes it.
            </Empty>
          )}
        </Section>
      ) : null}

      <div className="grid gap-16 md:grid-cols-2">
        <Section title="Record a payment">
          {outstanding > 0 && request ? (
            <RecordPaymentForm friendId={friend.id} outstanding={request.amount} />
          ) : (
            <Empty>Nothing to record: there is no outstanding request.</Empty>
          )}
        </Section>
        <Section title="Add credit">
          <AddCreditForm friendId={friend.id} />
        </Section>
      </div>

      <Section title="History" meta={history.length > 0 ? `${history.length}` : undefined}>
        {history.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((entry) => {
              const receipt = entry.receiptId ? receiptById.get(entry.receiptId) : undefined;
              return (
                <li key={entry.id} className="flex items-baseline justify-between gap-6 py-4">
                  <div>
                    <p className="text-ink">
                      {EVENT_LABEL[entry.type]}
                      {receipt ? ` ${receipt.title}` : ""}
                      {entry.note && entry.note !== receipt?.title ? <span className="text-ink-mute"> · {entry.note}</span> : null}
                    </p>
                    <p className="label mt-1">{formatDateTime(entry.createdAt)}</p>
                  </div>
                  <span className="amount">
                    {sign(entry)}
                    {money(entry.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function FriendPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <FriendDetail params={params} />
    </Suspense>
  );
}
