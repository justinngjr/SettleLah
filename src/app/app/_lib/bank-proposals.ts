import "server-only";

import type { Cents } from "@/domain";

/**
 * A bank-alert that reconciliation thinks matches a payment request. Session H
 * (bank-email reconciliation) owns the real implementation; the inbox codes
 * against this interface so wiring it up is a one-line swap below.
 */
export interface BankProposal {
  readonly id: string;
  readonly bank: string;
  readonly amount: Cents;
  readonly payerName: string | null;
  readonly reference: string | null;
  readonly receivedAt: string;
  readonly proposedFriendId: string | null;
  readonly proposedFriendName: string | null;
  readonly proposedPaymentRequestId: string | null;
}

export interface BankProposalSource {
  list(hostId: string): Promise<BankProposal[]>;
  confirm(hostId: string, proposalId: string): Promise<void>;
  reassign(hostId: string, proposalId: string, paymentRequestId: string): Promise<void>;
  ignore(hostId: string, proposalId: string): Promise<void>;
}

/** Until reconciliation lands there are never any proposals. */
export const noBankProposals: BankProposalSource = {
  async list() {
    return [];
  },
  async confirm() {
    throw new Error("Bank proposals are not available yet.");
  },
  async reassign() {
    throw new Error("Bank proposals are not available yet.");
  },
  async ignore() {
    throw new Error("Bank proposals are not available yet.");
  },
};

export const bankProposals: BankProposalSource = noBankProposals;
