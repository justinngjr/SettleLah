import "server-only";

import type { ParticipantId, SplitInput, SplitResult } from "@/domain";
import { assertNonNegativeCents, MoneyError } from "@/domain";

import type { DbClient } from "./client";
import type { Enums, Json } from "./database.types";
import { unwrapRequired } from "./errors";

export interface ReceiptInput {
  readonly title: string;
  /** Defaults to now. */
  readonly occurredAt?: Date | string;
  readonly source: Enums<"receipt_source">;
  /** The exact input the domain split was computed from, stored so it can be re-run. */
  readonly splitInput: SplitInput;
  /** The LLM's proposal, if any. Stored verbatim for audit; never used for maths. */
  readonly interpretation?: unknown;
  readonly telegramChatId?: number | null;
  readonly recurringExpenseId?: string | null;
  readonly createdBy?: Enums<"actor_type">;
}

/**
 * Participant id (as used in the split) -> friend id. The host's own
 * participant maps to `hostId` itself; their share is stored but never owed.
 */
export type FriendMap = Readonly<Record<ParticipantId, string>>;

export interface SaveSplitArgs {
  readonly p_receipt: Json;
  readonly p_shares: Json;
}

/** Pure mapping from domain objects to the `save_split` RPC arguments. */
export function buildSaveSplitArgs(
  hostId: string,
  receipt: ReceiptInput,
  split: SplitResult,
  friendMap: FriendMap,
): SaveSplitArgs {
  if (split.shares.length === 0) throw new MoneyError("saveSplit: the split has no shares");

  const seen = new Set<string>();
  const shares = split.shares.map((share) => {
    const target = friendMap[share.participantId];
    if (target === undefined) {
      throw new MoneyError(`saveSplit: participant ${share.participantId} is not mapped to a friend`);
    }
    if (seen.has(target)) throw new MoneyError(`saveSplit: ${target} is mapped from more than one participant`);
    seen.add(target);
    return {
      friendId: target === hostId ? null : target,
      amount: assertNonNegativeCents(share.amount, `share for ${share.participantId}`),
      itemsSubtotal: assertNonNegativeCents(share.itemsSubtotal, `itemsSubtotal for ${share.participantId}`),
      paysNothing: share.paysNothing,
    };
  });

  const sum = shares.reduce((acc, s) => acc + s.amount, 0);
  if (sum !== split.totals.total) {
    throw new MoneyError(`saveSplit: shares sum to ${sum} but the total is ${split.totals.total}`);
  }

  // The remainder policy is a function; everything else in SplitInput is plain data.
  const { remainderPolicy, ...splitInput } = receipt.splitInput;
  void remainderPolicy;
  const occurredAt = receipt.occurredAt instanceof Date ? receipt.occurredAt.toISOString() : receipt.occurredAt;

  const p_receipt = {
    hostId,
    title: receipt.title,
    occurredAt: occurredAt ?? null,
    source: receipt.source,
    serviceChargeBps: receipt.splitInput.charges.serviceChargeBps,
    gstBps: receipt.splitInput.charges.gstBps,
    subtotal: split.totals.subtotal,
    serviceCharge: split.totals.serviceCharge,
    gst: split.totals.gst,
    total: split.totals.total,
    interpretation: receipt.interpretation ?? null,
    splitInput,
    telegramChatId: receipt.telegramChatId ?? null,
    recurringExpenseId: receipt.recurringExpenseId ?? null,
    createdBy: receipt.createdBy ?? "host",
  };

  return { p_receipt: toJson(p_receipt), p_shares: toJson(shares) };
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/**
 * Persists a receipt, its shares and one `expense_share` ledger event per
 * friend owing > 0, atomically via the `save_split` Postgres function. On any
 * failure nothing is written. Returns the new receipt id.
 */
export async function saveSplit(
  db: DbClient,
  hostId: string,
  receipt: ReceiptInput,
  split: SplitResult,
  friendMap: FriendMap,
): Promise<string> {
  const args = buildSaveSplitArgs(hostId, receipt, split, friendMap);
  return unwrapRequired(await db.rpc("save_split", args), "saveSplit");
}
