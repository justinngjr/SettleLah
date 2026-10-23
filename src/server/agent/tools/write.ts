import "server-only";

import { z } from "zod";

import { formatSGD } from "@/domain";
import { refreshPaymentRequests } from "@/app/app/_lib/payment-requests";
import {
  appendLedgerEvent,
  archiveFriend,
  confirmPaymentClaim,
  createFriend,
  createPaymentClaim,
  listFriends,
  listPaymentRequests,
  listPendingClaims,
  rejectPaymentClaim,
  saveSplit,
  updateFriend,
} from "@/server/db";
import { confirmBankAlert, ignoreBankAlert, reassignBankAlert, ReconcileError } from "@/server/reconcile";
import { getBankAlert } from "@/server/reconcile/store";

import { cents, describeBalance, friendBalance, participantNames, requireFriend } from "./helpers";
import type { ActionPreview } from "./preview";
import { computeSplit, owingFriends, SaveSplitInputSchema, splitPreview } from "./split";
import { ToolError, writeTool, type ToolContext } from "./types";


const FriendId = z.string().min(1).describe("Friend id from resolve_friend / list_friends");
const Dollars = z.string().trim().min(1).describe('Amount in dollars as the host said it, e.g. "25" or "12.30"');

export const saveSplitTool = writeTool({
  name: "save_split",
  description:
    "Save a receipt split: records each person's share in the ledger and creates/updates payment requests for friends who owe. Prices are printed dollar strings; code computes every total and share. Usually pass the `draft` from interpret_receipt, edited only as the host instructed.",
  kind: "write",
  input: SaveSplitInputSchema,
  async preview(ctx, input) {
    return splitPreview(ctx, input.title, await computeSplit(ctx, input));
  },
  async run(ctx, input) {
    const computed = await computeSplit(ctx, input);
    // Participant ids are already friend ids (or the host), checked by computeSplit; same identity map as saveReceipt.
    const friendMap = Object.fromEntries(computed.participantIds.map((id) => [id, id]));
    const receiptId = await saveSplit(
      ctx.db,
      ctx.hostId,
      { title: input.title, source: input.source, splitInput: computed.splitInput },
      computed.split,
      friendMap,
    );
    const owing = owingFriends(ctx, computed);
    await refreshPaymentRequests(ctx.db, ctx.hostId, owing);
    return { receiptId, total: formatSGD(computed.split.totals.total), owingFriendIds: owing };
  },
});

export const addFriendTool = writeTool({
  name: "add_friend",
  description: "Add a new friend by display name. Check resolve_friend first so you do not add a duplicate.",
  kind: "write",
  input: z.object({ name: z.string().trim().min(1).max(80) }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friends = await listFriends(ctx.db, ctx.hostId, { includeArchived: true });
    const clash = friends.find((f) => f.displayName.toLowerCase() === input.name.toLowerCase());
    return {
      title: `Add friend: ${input.name}`,
      summary: "Adds this person to your friends so you can split bills with them.",
      rows: [{ label: "Name", value: input.name }],
      ...(clash ? { warnings: [`You already have a friend named ${clash.displayName}${clash.archived ? " (archived)" : ""}.`] } : {}),
      openInApp: "/app/friends",
    };
  },
  async run(ctx, input) {
    const friend = await createFriend(ctx.db, ctx.hostId, { displayName: input.name });
    return { friendId: friend.id, name: friend.displayName };
  },
});

export const renameFriendTool = writeTool({
  name: "rename_friend",
  description: "Change a friend's display name.",
  kind: "write",
  input: z.object({ friendId: FriendId, name: z.string().trim().min(1).max(80) }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friend = await requireFriend(ctx, input.friendId);
    return {
      title: `Rename ${friend.displayName} to ${input.name}`,
      summary: "Changes how this friend appears everywhere in the app.",
      rows: [
        { label: "Current", value: friend.displayName },
        { label: "New", value: input.name, strong: true },
      ],
      openInApp: `/app/friends/${friend.id}`,
    };
  },
  async run(ctx, input) {
    const friend = await updateFriend(ctx.db, ctx.hostId, input.friendId, { displayName: input.name });
    return { friendId: friend.id, name: friend.displayName };
  },
});

export const archiveFriendTool = writeTool({
  name: "archive_friend",
  description: "Archive (hide) a friend. Their history stays; they can be unarchived in the app.",
  kind: "write",
  input: z.object({ friendId: FriendId }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friend = await requireFriend(ctx, input.friendId);
    if (friend.archived) throw new ToolError("invalid_state", `${friend.displayName} is already archived`);
    const balance = await friendBalance(ctx, friend.id);
    return {
      title: `Archive ${friend.displayName}`,
      summary: "Hides this friend from your lists. Nothing in the ledger changes.",
      rows: [{ label: "Balance", value: describeBalance(balance) }],
      ...(balance !== 0 ? { warnings: [`${friend.displayName} is not settled (${describeBalance(balance)}); they stay visible on Home until they are.`] } : {}),
      openInApp: `/app/friends/${friend.id}`,
    };
  },
  async run(ctx, input) {
    const friend = await archiveFriend(ctx.db, ctx.hostId, input.friendId);
    return { friendId: friend.id, archived: friend.archived };
  },
});

async function paymentRows(ctx: ToolContext, friendId: string, amount: number, verb: string) {
  const balance = await friendBalance(ctx, friendId);
  const after = balance - amount;
  return {
    rows: [
      { label: verb, value: formatSGD(amount), strong: true },
      { label: "Owes now", value: describeBalance(balance) },
      { label: "After", value: describeBalance(after) },
    ],
    ...(after < 0 ? { warnings: [`This is ${formatSGD(-after)} more than owed; the extra becomes credit.`] } : {}),
  };
}

export const recordPaymentTool = writeTool({
  name: "record_payment",
  description:
    "Record that a friend paid the host outside the app (cash, PayNow seen in the bank app, ...). The friend must have an open payment request. Overpayment becomes credit.",
  kind: "write",
  input: z.object({ friendId: FriendId, amount: Dollars, method: z.string().trim().max(40).optional().describe("e.g. cash, PayNow") }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friend = await requireFriend(ctx, input.friendId);
    const amount = cents(input.amount);
    const [request] = await listPaymentRequests(ctx.db, ctx.hostId, { friendId: friend.id, status: "open" });
    if (!request) throw new ToolError("invalid_state", `${friend.displayName} has no open payment request; use add_credit if they paid for something`);
    const { rows, warnings } = await paymentRows(ctx, friend.id, amount, "Payment");
    return {
      title: `Record payment: ${friend.displayName} paid ${formatSGD(amount)}${input.method ? ` by ${input.method}` : ""}`,
      summary: "Marks this payment as received and updates what they owe.",
      rows: [...rows, { label: "Request", value: `${formatSGD(request.amount)} · ref ${request.reference}` }],
      ...(warnings ? { warnings } : {}),
      openInApp: `/app/friends/${friend.id}`,
    };
  },
  async run(ctx, input) {
    const amount = cents(input.amount);
    const [request] = await listPaymentRequests(ctx.db, ctx.hostId, { friendId: input.friendId, status: "open" });
    if (!request) throw new ToolError("invalid_state", "no open payment request for this friend");
    const claim = await createPaymentClaim(ctx.db, ctx.hostId, { paymentRequestId: request.id, source: "friend_button", amount });
    const ledgerEventId = await confirmPaymentClaim(ctx.db, claim.id, amount);
    await refreshPaymentRequests(ctx.db, ctx.hostId, [input.friendId]);
    const balance = await friendBalance(ctx, input.friendId);
    return { claimId: claim.id, ledgerEventId, amount: formatSGD(amount), balance: describeBalance(balance) };
  },
});

async function pendingClaim(ctx: ToolContext, claimId: string) {
  const claim = (await listPendingClaims(ctx.db, ctx.hostId)).find((c) => c.id === claimId);
  if (!claim) throw new ToolError("not_found", `no pending claim ${claimId}; see list_pending_claims`);
  const [request] = (await listPaymentRequests(ctx.db, ctx.hostId, {})).filter((r) => r.id === claim.paymentRequestId);
  if (!request) throw new ToolError("not_found", "the claim's payment request is gone");
  const names = await participantNames(ctx, [request.friendId]);
  return { claim, request, name: names.get(request.friendId) ?? "(unknown)" };
}

export const confirmClaimTool = writeTool({
  name: "confirm_claim",
  description: "Confirm a friend's pending 'I paid' claim, optionally correcting the amount actually received.",
  kind: "write",
  input: z.object({ claimId: z.string().min(1), amount: Dollars.optional().describe("Only if the host says a different amount arrived") }),
  async preview(ctx, input): Promise<ActionPreview> {
    const { claim, request, name } = await pendingClaim(ctx, input.claimId);
    const amount = input.amount ? cents(input.amount) : (claim.amount ?? request.amount);
    const { rows, warnings } = await paymentRows(ctx, request.friendId, amount, "Payment");
    return {
      title: `Confirm payment: ${name} paid ${formatSGD(amount)}`,
      summary: "Accepts the claim and records the payment in the ledger.",
      rows,
      ...(warnings ? { warnings } : {}),
      openInApp: "/app/inbox",
    };
  },
  async run(ctx, input) {
    const { request } = await pendingClaim(ctx, input.claimId);
    const ledgerEventId = await confirmPaymentClaim(ctx.db, input.claimId, input.amount ? cents(input.amount) : undefined);
    await refreshPaymentRequests(ctx.db, ctx.hostId, [request.friendId]);
    return { claimId: input.claimId, ledgerEventId };
  },
});

export const rejectClaimTool = writeTool({
  name: "reject_claim",
  description: "Reject a friend's pending 'I paid' claim; the request stays open.",
  kind: "write",
  input: z.object({ claimId: z.string().min(1) }),
  async preview(ctx, input): Promise<ActionPreview> {
    const { claim, request, name } = await pendingClaim(ctx, input.claimId);
    return {
      title: `Reject claim: ${name}`,
      summary: "Marks the claim as not received; nothing is recorded and the request stays open.",
      rows: [{ label: "Claimed", value: formatSGD(claim.amount ?? request.amount) }],
      openInApp: "/app/inbox",
    };
  },
  async run(ctx, input) {
    await pendingClaim(ctx, input.claimId);
    await rejectPaymentClaim(ctx.db, input.claimId);
    return { claimId: input.claimId, status: "rejected" };
  },
});

export const addCreditTool = writeTool({
  name: "add_credit",
  description: "Give a friend credit (e.g. they paid for something for the host). Reduces what they owe; may leave them with credit.",
  kind: "write",
  input: z.object({ friendId: FriendId, amount: Dollars, note: z.string().trim().max(200).optional() }),
  async preview(ctx, input): Promise<ActionPreview> {
    const friend = await requireFriend(ctx, input.friendId);
    const amount = cents(input.amount);
    const { rows } = await paymentRows(ctx, friend.id, amount, "Credit");
    return {
      title: `Add credit: ${formatSGD(amount)} for ${friend.displayName}`,
      summary: "Adds a credit line to their ledger.",
      rows: [...rows, ...(input.note ? [{ label: "Note", value: input.note }] : [])],
      openInApp: `/app/friends/${friend.id}`,
    };
  },
  async run(ctx, input) {
    const amount = cents(input.amount);
    await appendLedgerEvent(ctx.db, ctx.hostId, {
      friendId: input.friendId,
      type: "credit",
      amount,
      ...(input.note ? { note: input.note } : {}),
      createdBy: "host",
    });
    await refreshPaymentRequests(ctx.db, ctx.hostId, [input.friendId]);
    const balance = await friendBalance(ctx, input.friendId);
    return { amount: formatSGD(amount), balance: describeBalance(balance) };
  },
});

async function proposedAlert(ctx: ToolContext, alertId: string) {
  const alert = await getBankAlert(ctx.db, ctx.hostId, alertId);
  if (!alert) throw new ToolError("not_found", `no bank alert ${alertId}; see list_bank_proposals`);
  return alert;
}

function reconcileFailure(error: unknown): never {
  if (error instanceof ReconcileError) throw new ToolError(error.code === "not_found" ? "not_found" : "invalid_state", error.message);
  throw error;
}

export const confirmBankMatchTool = writeTool({
  name: "confirm_bank_match",
  description: "Confirm a proposed bank-alert match: records the transfer as a payment on the proposed (or given) open request.",
  kind: "write",
  input: z.object({ alertId: z.string().min(1), paymentRequestId: z.string().min(1).optional().describe("Override the proposed request") }),
  async preview(ctx, input): Promise<ActionPreview> {
    const alert = await proposedAlert(ctx, input.alertId);
    const requestId = input.paymentRequestId ?? alert.proposedPaymentRequestId;
    if (!requestId) throw new ToolError("invalid_state", "this alert has no proposed request; use reassign_bank_match with a paymentRequestId");
    const request = (await listPaymentRequests(ctx.db, ctx.hostId, { status: "open" })).find((r) => r.id === requestId);
    if (!request) throw new ToolError("not_found", `open payment request ${requestId} not found`);
    const names = await participantNames(ctx, [request.friendId]);
    const { rows, warnings } = await paymentRows(ctx, request.friendId, alert.amount, "Transfer");
    return {
      title: `Confirm ${alert.bank} transfer: ${formatSGD(alert.amount)} from ${names.get(request.friendId)}`,
      summary: "Records the bank transfer as this friend's payment.",
      rows: [...rows, { label: "Payer", value: alert.payerName ?? "(not shown)" }, { label: "Reference", value: alert.reference ?? "(none)" }],
      ...(warnings ? { warnings } : {}),
      openInApp: "/app/inbox",
    };
  },
  async run(ctx, input) {
    try {
      const result = await confirmBankAlert(ctx.db, ctx.hostId, input.alertId, { paymentRequestId: input.paymentRequestId ?? null });
      return { alertId: input.alertId, status: result.alert.status };
    } catch (error) {
      return reconcileFailure(error);
    }
  },
});

export const reassignBankMatchTool = writeTool({
  name: "reassign_bank_match",
  description: "Point a bank alert at a different open payment request (does not confirm it).",
  kind: "write",
  input: z.object({ alertId: z.string().min(1), paymentRequestId: z.string().min(1) }),
  async preview(ctx, input): Promise<ActionPreview> {
    const alert = await proposedAlert(ctx, input.alertId);
    const request = (await listPaymentRequests(ctx.db, ctx.hostId, { status: "open" })).find((r) => r.id === input.paymentRequestId);
    if (!request) throw new ToolError("not_found", `open payment request ${input.paymentRequestId} not found`);
    const names = await participantNames(ctx, [request.friendId]);
    return {
      title: `Reassign ${alert.bank} transfer of ${formatSGD(alert.amount)} to ${names.get(request.friendId)}`,
      summary: "Changes which request this transfer is matched to. Confirm it separately.",
      rows: [
        { label: "Transfer", value: formatSGD(alert.amount) },
        { label: "Request", value: `${formatSGD(request.amount)} · ref ${request.reference}` },
      ],
      openInApp: "/app/inbox",
    };
  },
  async run(ctx, input) {
    try {
      const alert = await reassignBankAlert(ctx.db, ctx.hostId, input.alertId, input.paymentRequestId);
      return { alertId: alert.id, proposedPaymentRequestId: alert.proposedPaymentRequestId };
    } catch (error) {
      return reconcileFailure(error);
    }
  },
});

export const ignoreBankAlertTool = writeTool({
  name: "ignore_bank_alert",
  description: "Ignore a bank alert that is not a friend's payment.",
  kind: "write",
  input: z.object({ alertId: z.string().min(1), reason: z.string().trim().max(120).optional() }),
  async preview(ctx, input): Promise<ActionPreview> {
    const alert = await proposedAlert(ctx, input.alertId);
    return {
      title: `Ignore ${alert.bank} transfer of ${formatSGD(alert.amount)}`,
      summary: "Hides this alert; nothing is recorded.",
      rows: [{ label: "Payer", value: alert.payerName ?? "(not shown)" }, ...(input.reason ? [{ label: "Reason", value: input.reason }] : [])],
      openInApp: "/app/inbox",
    };
  },
  async run(ctx, input) {
    try {
      const alert = await ignoreBankAlert(ctx.db, ctx.hostId, input.alertId, input.reason ?? null);
      return { alertId: alert.id, status: alert.status };
    } catch (error) {
      return reconcileFailure(error);
    }
  },
});
