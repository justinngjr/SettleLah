import "server-only";

import { z } from "zod";

import {
  formatSGD,
  hostNeverAbsorbs,
  MoneyError,
  NO_CHARGES,
  SG_GST_ONLY,
  SG_SERVICE_CHARGE_BPS,
  SG_STANDARD_CHARGES,
  splitReceipt,
  type ChargePolicy,
  type LineItem,
  type SplitInput,
  type SplitResult,
} from "@/domain";

import { cents, participantId, participantNames } from "./helpers";
import type { ActionPreview, PreviewShare } from "./preview";
import { ToolError, type ToolContext } from "./types";

/** The Confirm screen's three choices plus "service charge only" (GST-inclusive prices), which `interpretReceipt` can produce. */
export const CHARGE_POLICIES: Readonly<Record<"sc_gst" | "sc" | "gst" | "none", ChargePolicy>> = {
  sc_gst: SG_STANDARD_CHARGES,
  sc: { serviceChargeBps: SG_SERVICE_CHARGE_BPS, gstBps: 0 },
  gst: SG_GST_ONLY,
  none: NO_CHARGES,
};

export type ChargeChoice = keyof typeof CHARGE_POLICIES;

export function chargeChoiceFor(policy: ChargePolicy): ChargeChoice {
  if (policy.serviceChargeBps > 0) return policy.gstBps > 0 ? "sc_gst" : "sc";
  if (policy.gstBps > 0) return "gst";
  return "none";
}

const Id = z.string().min(1);

/**
 * Everything needed to save a split, with money only as printed dollar
 * strings. Totals, shares and rounding are always computed by `splitReceipt`;
 * there is deliberately no field for a per-person amount.
 */
export const SaveSplitInputSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("Receipt title, e.g. 'Dinner at Noodle Place'"),
  participantIds: z.array(Id).min(1).describe('Everyone at the table: friend ids plus "host"'),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        price: z.string().trim().min(1).describe('Line total in dollars exactly as printed, e.g. "12.30"'),
        sharedBy: z.array(Id).min(1).describe("Participant ids sharing this line"),
        weights: z.record(z.string(), z.number().int().positive()).optional().describe("Optional relative weights keyed by participant id"),
      }),
    )
    .min(1),
  charges: z
    .enum(["sc_gst", "sc", "gst", "none"])
    .describe("sc_gst = 10% service charge + 9% GST on top; sc = service charge only; gst = 9% GST only; none = prices are nett"),
  excluded: z.array(Id).default([]).describe("Participants who pay nothing for this receipt"),
  redistribute: z.enum(["proportional", "equal"]).default("proportional").describe("How excluded participants' item shares spread over the payers"),
  treatedBy: Id.nullable().default(null).describe("One participant pays everything; everyone else owes 0"),
  source: z.enum(["manual", "llm"]).default("llm"),
});

export type SaveSplitInput = z.infer<typeof SaveSplitInputSchema>;

export interface ComputedSplit {
  readonly splitInput: SplitInput;
  readonly split: SplitResult;
  readonly names: ReadonlyMap<string, string>;
  readonly participantIds: readonly string[];
}

/** Mirrors `saveReceipt`: build the domain input from the host's choices and let `splitReceipt` do the money. */
export async function computeSplit(ctx: ToolContext, input: SaveSplitInput): Promise<ComputedSplit> {
  const map = (id: string) => participantId(ctx, id);
  const participantIds = Array.from(new Set(input.participantIds.map(map)));
  const names = await participantNames(ctx, participantIds);
  const known = new Set(participantIds);
  const check = (id: string, where: string) => {
    if (!known.has(id)) throw new ToolError("invalid_input", `${where}: ${id} is not in participantIds`);
    return id;
  };
  const items: LineItem[] = input.items.map((item, index) => ({
    label: item.label,
    price: cents(item.price, `items[${index}].price`),
    sharedBy: item.sharedBy.map((id) => check(map(id), `items[${index}].sharedBy`)),
    ...(item.weights ? { weights: Object.fromEntries(Object.entries(item.weights).map(([id, w]) => [check(map(id), `items[${index}].weights`), w])) } : {}),
  }));
  const excluded = input.excluded.map((id) => check(map(id), "excluded"));
  const treatedBy = input.treatedBy === null ? null : check(map(input.treatedBy), "treatedBy");
  const splitInput: SplitInput = {
    items,
    charges: CHARGE_POLICIES[input.charges],
    participants: participantIds,
    remainderPolicy: hostNeverAbsorbs(ctx.hostId),
    ...(excluded.length > 0 ? { exclusion: { participants: excluded, redistribute: input.redistribute } } : {}),
    ...(treatedBy ? { treatedBy } : {}),
  };
  try {
    return { splitInput, split: splitReceipt(splitInput), names, participantIds };
  } catch (error) {
    if (error instanceof MoneyError) throw new ToolError("invalid_input", `split failed: ${error.message}`);
    throw error;
  }
}

export function splitShares(computed: ComputedSplit): PreviewShare[] {
  return computed.split.shares.map((share) => ({
    participantId: share.participantId,
    name: computed.names.get(share.participantId) ?? share.participantId,
    amount: formatSGD(share.amount),
    paysNothing: share.paysNothing,
  }));
}

export function owingFriends(ctx: ToolContext, computed: ComputedSplit): string[] {
  return computed.split.shares.filter((s) => s.participantId !== ctx.hostId && !s.paysNothing && s.amount > 0).map((s) => s.participantId);
}

export function splitPreview(ctx: ToolContext, title: string, computed: ComputedSplit): ActionPreview {
  const { totals } = computed.split;
  const owing = owingFriends(ctx, computed);
  return {
    title: `Save split: ${title}`,
    summary: `Saves the receipt and records what each person owes; open payment requests are updated for ${owing.length} ${owing.length === 1 ? "friend" : "friends"}.`,
    rows: [
      { label: "Subtotal", value: formatSGD(totals.subtotal) },
      ...(totals.serviceCharge > 0 ? [{ label: "Service charge", value: formatSGD(totals.serviceCharge) }] : []),
      ...(totals.gst > 0 ? [{ label: "GST", value: formatSGD(totals.gst) }] : []),
      { label: "Total", value: formatSGD(totals.total), strong: true },
    ],
    shares: splitShares(computed),
    openInApp: "/app",
  };
}
