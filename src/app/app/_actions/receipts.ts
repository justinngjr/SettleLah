"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hostNeverAbsorbs, MoneyError, splitReceipt, type SplitInput } from "@/domain";
import { listFriends, saveSplit } from "@/server/db";
import { notifySplit } from "@/server/telegram";
import { TelegramNotConfiguredError } from "@/server/telegram/deps";

import { requireHost } from "../_lib/host";
import { refreshPaymentRequests } from "../_lib/payment-requests";
import { CHARGE_POLICIES } from "../_lib/receipt-draft";

const Cents = z.number().int().min(0);

const PayloadSchema = z.object({
  title: z.string().trim().min(1).max(120),
  source: z.enum(["manual", "llm"]),
  participantIds: z.array(z.string().min(1)).min(1),
  items: z
    .array(
      z.object({
        label: z.string().max(200),
        price: Cents,
        sharedBy: z.array(z.string().min(1)).min(1),
        weights: z.record(z.string(), z.number().int().positive()).optional(),
      }),
    )
    .min(1),
  charges: z.enum(["sc_gst", "gst", "none"]),
  excluded: z.array(z.string().min(1)),
  redistribute: z.enum(["proportional", "equal"]),
  treatedBy: z.string().min(1).nullable(),
  interpretation: z.unknown().optional(),
  expectedTotal: Cents,
  telegramChatId: z.number().int().nullable().optional(),
});

export type SaveReceiptResult =
  | {
      readonly ok: true;
      readonly receiptId: string;
      /** Set when the split was saved but posting it to the Telegram group failed. */
      readonly notifyError?: string;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Confirm: the server recomputes the split from the payload (authoritative),
 * saves it atomically, then makes sure each friend has at most one open
 * payment request, for their current outstanding amount.
 */
export async function saveReceipt(raw: unknown): Promise<SaveReceiptResult> {
  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The receipt could not be read. Go back and check the items." };
  const payload = parsed.data;

  const { host, db } = await requireHost("/app/receipts/new");

  if (!payload.participantIds.includes(host.id)) return { ok: false, error: "You must be one of the participants." };
  const friends = await listFriends(db, host.id);
  const friendIds = new Set(friends.map((f) => f.id));
  const unknown = payload.participantIds.filter((id) => id !== host.id && !friendIds.has(id));
  if (unknown.length > 0) return { ok: false, error: "A participant is not one of your friends any more. Go back and re-select." };

  const splitInput: SplitInput = {
    items: payload.items,
    charges: CHARGE_POLICIES[payload.charges],
    participants: payload.participantIds,
    remainderPolicy: hostNeverAbsorbs(host.id),
    ...(payload.excluded.length > 0 ? { exclusion: { participants: payload.excluded, redistribute: payload.redistribute } } : {}),
    ...(payload.treatedBy ? { treatedBy: payload.treatedBy } : {}),
  };

  let split;
  try {
    split = splitReceipt(splitInput);
  } catch (error) {
    if (error instanceof MoneyError) return { ok: false, error: error.message };
    throw error;
  }
  if (split.totals.total !== payload.expectedTotal) {
    return { ok: false, error: "The total changed while confirming. Review the receipt and confirm again." };
  }

  const friendMap = Object.fromEntries(payload.participantIds.map((id) => [id, id]));
  let receiptId: string;
  try {
    receiptId = await saveSplit(
      db,
      host.id,
      {
        title: payload.title,
        source: payload.source,
        splitInput,
        interpretation: payload.interpretation,
        telegramChatId: payload.telegramChatId ?? null,
      },
      split,
      friendMap,
    );
  } catch (error) {
    console.error("[saveReceipt] saveSplit", error);
    return { ok: false, error: "Could not save the receipt. Nothing was recorded; try again." };
  }

  const owingFriends = split.shares.filter((s) => s.participantId !== host.id && s.amount > 0).map((s) => s.participantId);
  try {
    await refreshPaymentRequests(db, host.id, owingFriends);
  } catch (error) {
    console.error("[saveReceipt] payment requests", error);
    // The receipt is saved and the ledger is right; requests can be re-issued from the friend page.
  }

  revalidatePath("/app");
  revalidatePath("/app/friends");

  const telegramChatId = payload.telegramChatId ?? null;
  if (telegramChatId === null) return { ok: true, receiptId };
  try {
    await notifySplit({ hostId: host.id, receiptId, telegramChatId });
  } catch (error) {
    console.error("[saveReceipt] notifySplit", error);
    const why = error instanceof TelegramNotConfiguredError ? "Telegram is not configured on this server." : "Telegram did not accept the post.";
    return { ok: true, receiptId, notifyError: `The split is saved, but it was not posted to the group. ${why}` };
  }
  return { ok: true, receiptId };
}
