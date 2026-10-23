import type { SplitResult } from "@/domain";
import { Row, Rows } from "@/app/_ui";

import { money } from "../../_lib/format";
import type { DraftParticipant } from "../../_lib/receipt-draft";

/** Totals and per-person shares, straight from the domain's `SplitResult`. */
export function SplitSummary({ split, participants }: { split: SplitResult; participants: readonly DraftParticipant[] }) {
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div className="space-y-3">
        <p className="label">Totals</p>
        <Rows>
          <Row term="Subtotal">{money(split.totals.subtotal)}</Row>
          <Row term="Service charge">{money(split.totals.serviceCharge)}</Row>
          <Row term="GST">{money(split.totals.gst)}</Row>
          <Row term="Total" strong>
            {money(split.totals.total)}
          </Row>
        </Rows>
      </div>
      <div className="space-y-3">
        <p className="label">Each person pays</p>
        <Rows>
          {split.shares.map((share) => {
            const participant = participants.find((p) => p.id === share.participantId);
            return (
              <Row key={share.participantId} term={`${nameOf(share.participantId)}${participant?.isHost ? " (you)" : ""}`}>
                {share.paysNothing ? <span className="text-ink-mute">pays nothing</span> : money(share.amount)}
              </Row>
            );
          })}
        </Rows>
      </div>
    </div>
  );
}
