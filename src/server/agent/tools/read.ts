import "server-only";

import { z } from "zod";

import { formatSGD } from "@/domain";
import {
  listBalances,
  listFriends,
  listLedgerHistory,
  listPaymentRequests,
  listPendingClaims,
  listRecentReceipts,
} from "@/server/db";
import { InterpretError } from "@/server/interpret/errors";
import { interpretReceipt, toChargePolicy } from "@/server/interpret/interpret";
import { listBankAlerts } from "@/server/reconcile";

import { HOST_ALIAS, participantId, participantNames, summarizeFriend } from "./helpers";
import { chargeChoiceFor, SaveSplitInputSchema, type SaveSplitInput } from "./split";
import { readTool, ToolError } from "./types";

const FriendIdSchema = z.string().min(1).describe("Friend id from resolve_friend / list_friends");

export const resolveFriend = readTool({
  name: "resolve_friend",
  description:
    "Find friends whose name matches. Returns candidates with ids; ALWAYS use this (or list_friends) to get an id instead of guessing. Zero candidates means the friend does not exist yet; several means ask the host which one.",
  kind: "read",
  input: z.object({ name: z.string().trim().min(1).describe("Name or part of a name as the host typed it") }),
  async run(ctx, input) {
    const needle = input.name.toLowerCase();
    const friends = await listFriends(ctx.db, ctx.hostId, { includeArchived: true });
    const exact = friends.filter((f) => f.displayName.toLowerCase() === needle);
    const partial = friends.filter((f) => f.displayName.toLowerCase().includes(needle) && !exact.includes(f));
    const candidates = (exact.length > 0 ? exact : partial).filter((f) => !f.archived || exact.includes(f));
    return { query: input.name, candidates: candidates.map(summarizeFriend) };
  },
});

export const listFriendsTool = readTool({
  name: "list_friends",
  description: "All of the host's friends (people they split bills with) with ids.",
  kind: "read",
  input: z.object({ includeArchived: z.boolean().optional() }),
  async run(ctx, input) {
    const friends = await listFriends(ctx.db, ctx.hostId, { includeArchived: input.includeArchived ?? false });
    return { friends: friends.map(summarizeFriend) };
  },
});

export const getBalances = readTool({
  name: "get_balances",
  description: "Who owes the host what. Positive = the friend owes the host; negative = the friend holds credit.",
  kind: "read",
  input: z.object({}),
  async run(ctx) {
    const balances = await listBalances(ctx.db, ctx.hostId);
    return {
      balances: balances.map((b) => ({
        friendId: b.friend.id,
        name: b.friend.displayName,
        balance: formatSGD(b.balance),
        owesHost: b.balance > 0,
        hasCredit: b.balance < 0,
      })),
    };
  },
});

export const getFriendLedger = readTool({
  name: "get_friend_ledger",
  description: "A friend's ledger history (expense shares, payments, credits), newest first.",
  kind: "read",
  input: z.object({ friendId: FriendIdSchema }),
  async run(ctx, input) {
    const [names, history] = await Promise.all([participantNames(ctx, [input.friendId]), listLedgerHistory(ctx.db, ctx.hostId, input.friendId)]);
    return {
      friendId: input.friendId,
      name: names.get(input.friendId),
      events: history.map((e) => ({ id: e.id, type: e.type, amount: formatSGD(e.amount), note: e.note, receiptId: e.receiptId, at: e.createdAt })),
    };
  },
});

export const listOpenRequests = readTool({
  name: "list_open_requests",
  description: "Open payment requests (what each friend has been asked to pay, with the PayNow reference).",
  kind: "read",
  input: z.object({ friendId: FriendIdSchema.optional() }),
  async run(ctx, input) {
    const requests = await listPaymentRequests(ctx.db, ctx.hostId, { status: "open", ...(input.friendId ? { friendId: input.friendId } : {}) });
    const names = await participantNames(ctx, []);
    return {
      requests: requests.map((r) => ({
        id: r.id,
        friendId: r.friendId,
        name: names.get(r.friendId) ?? "(unknown)",
        amount: formatSGD(r.amount),
        reference: r.reference,
        note: r.note,
        createdAt: r.createdAt,
      })),
    };
  },
});

export const listPendingClaimsTool = readTool({
  name: "list_pending_claims",
  description: "Payments friends say they made that the host has not confirmed yet (the Inbox).",
  kind: "read",
  input: z.object({}),
  async run(ctx) {
    const [claims, requests, names] = await Promise.all([
      listPendingClaims(ctx.db, ctx.hostId),
      listPaymentRequests(ctx.db, ctx.hostId, {}),
      participantNames(ctx, []),
    ]);
    const requestById = new Map(requests.map((r) => [r.id, r]));
    return {
      claims: claims.map((c) => {
        const request = requestById.get(c.paymentRequestId);
        return {
          id: c.id,
          source: c.source,
          friendId: request?.friendId ?? null,
          name: request ? (names.get(request.friendId) ?? "(unknown)") : "(unknown)",
          requestAmount: request ? formatSGD(request.amount) : null,
          claimedAmount: c.amount === null ? null : formatSGD(c.amount),
          claimedAt: c.claimedAt,
        };
      }),
    };
  },
});

export const listBankProposals = readTool({
  name: "list_bank_proposals",
  description: "Bank transfer alerts that were matched to an open request and wait for the host to confirm, reassign or ignore.",
  kind: "read",
  input: z.object({}),
  async run(ctx) {
    const [alerts, names] = await Promise.all([listBankAlerts(ctx.db, ctx.hostId, { status: "proposed" }), participantNames(ctx, [])]);
    return {
      proposals: alerts.map((a) => ({
        id: a.id,
        bank: a.bank,
        amount: formatSGD(a.amount),
        payerName: a.payerName,
        reference: a.reference,
        receivedAt: a.receivedAt,
        proposedFriendId: a.proposedFriendId,
        proposedFriendName: a.proposedFriendId ? (names.get(a.proposedFriendId) ?? null) : null,
        proposedPaymentRequestId: a.proposedPaymentRequestId,
        confidence: a.matchConfidence,
        reason: a.matchReason,
      })),
    };
  },
});

export const listReceipts = readTool({
  name: "list_receipts",
  description: "Recent saved receipts (splits), newest first.",
  kind: "read",
  input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  async run(ctx, input) {
    const receipts = await listRecentReceipts(ctx.db, ctx.hostId, input.limit ?? 10);
    return { receipts: receipts.map((r) => ({ id: r.id, title: r.title, total: formatSGD(r.total), occurredAt: r.occurredAt, source: r.source })) };
  },
});

export const InterpretReceiptInputSchema = z.object({
  receiptText: z.string().trim().min(1).max(20_000).optional().describe("The receipt as text, if the host pasted or typed it"),
  useAttachedImage: z.boolean().optional().describe("True to read the photo the host attached to this message"),
  note: z
    .string()
    .max(4000)
    .default("")
    .describe("The host's instructions about who had what, e.g. 'Sarah skipped drinks', verbatim"),
  title: z.string().trim().min(1).max(120).optional().describe("Receipt title, e.g. the restaurant name"),
  participantIds: z
    .array(z.string().min(1))
    .min(1)
    .describe(`Everyone at the table: friend ids plus "${HOST_ALIAS}" for the host`),
});

export const interpretReceiptTool = readTool({
  name: "interpret_receipt",
  description:
    "Read a receipt (text or the attached photo) plus the host's note and return a DRAFT split: items, who shares what, computed totals and per-person shares, and open questions. Saves nothing. Pass the returned `draft` to save_split unchanged (after answering any questions) to save it.",
  kind: "read",
  input: InterpretReceiptInputSchema,
  async run(ctx, input) {
    if (!ctx.interpret) throw new ToolError("unavailable", "receipt interpretation is not configured on this server");
    if (input.useAttachedImage && !ctx.attachedImage) throw new ToolError("invalid_input", "the host did not attach a photo to this message");
    if (!input.useAttachedImage && !input.receiptText) throw new ToolError("invalid_input", "provide receiptText or set useAttachedImage");

    const ids = Array.from(new Set(input.participantIds.map((id) => participantId(ctx, id))));
    if (!ids.includes(ctx.hostId)) ids.unshift(ctx.hostId);
    const names = await participantNames(ctx, ids);
    const participants = ids.map((id) => ({ id, name: id === ctx.hostId ? "the host" : (names.get(id) ?? id) }));

    try {
      const result = await interpretReceipt(
        {
          hostId: ctx.hostId,
          participants,
          note: input.note,
          ...(input.useAttachedImage && ctx.attachedImage ? { image: ctx.attachedImage } : {}),
          ...(input.receiptText ? { receiptText: input.receiptText } : {}),
        },
        ctx.interpret,
      );
      const { interpretation, split } = result;
      const draft: SaveSplitInput = SaveSplitInputSchema.parse({
        title: input.title ?? "Receipt",
        participantIds: ids,
        items: interpretation.items.map((item) => ({
          label: item.label,
          price: item.price,
          sharedBy: item.sharedBy,
          ...(item.weights ? { weights: item.weights } : {}),
        })),
        charges: chargeChoiceFor(toChargePolicy(interpretation.charges)),
        excluded: interpretation.exclusion?.participants ?? [],
        redistribute: interpretation.exclusion?.redistribute ?? "proportional",
        treatedBy: interpretation.treatedBy ?? null,
      });
      return {
        draft,
        computed: {
          subtotal: formatSGD(split.totals.subtotal),
          serviceCharge: formatSGD(split.totals.serviceCharge),
          gst: formatSGD(split.totals.gst),
          total: formatSGD(split.totals.total),
          shares: split.shares.map((s) => ({ participantId: s.participantId, name: names.get(s.participantId) ?? s.participantId, amount: formatSGD(s.amount), paysNothing: s.paysNothing })),
        },
        questions: interpretation.questions,
        assumptions: interpretation.assumptions,
        warnings: result.warnings,
      };
    } catch (error) {
      if (error instanceof InterpretError) throw new ToolError("failed", `could not interpret the receipt (${error.code}): ${error.message}`);
      throw error;
    }
  },
});
