import "server-only";

import type { Cents } from "@/domain";

import type { DbClient } from "./client";
import type { Enums, Tables } from "./database.types";
import { unwrap } from "./errors";

export type ReceiptRow = Tables<"receipts">;
export type ReceiptShareRow = Tables<"receipt_shares">;

/** A saved receipt's header; amounts are what `save_split` stored (cents). */
export interface ReceiptSummary {
  readonly id: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly source: Enums<"receipt_source">;
  readonly subtotal: Cents;
  readonly serviceCharge: Cents;
  readonly gst: Cents;
  readonly total: Cents;
}

export function toReceiptSummary(row: ReceiptRow): ReceiptSummary {
  return {
    id: row.id,
    title: row.title,
    occurredAt: row.occurred_at,
    source: row.source,
    subtotal: row.subtotal,
    serviceCharge: row.service_charge,
    gst: row.gst,
    total: row.total,
  };
}

/** Receipt headers for the given ids, so ledger `expense_share` rows can show the bill they came from. */
export async function listReceiptsById(db: DbClient, hostId: string, ids: readonly string[]): Promise<ReceiptSummary[]> {
  if (ids.length === 0) return [];
  const rows =
    unwrap(await db.from("receipts").select("*").eq("host_id", hostId).in("id", [...ids]), "listReceiptsById") ?? [];
  return rows.map(toReceiptSummary);
}

/** Most recent receipts first. */
export async function listRecentReceipts(db: DbClient, hostId: string, limit = 20): Promise<ReceiptSummary[]> {
  const rows =
    unwrap(
      await db.from("receipts").select("*").eq("host_id", hostId).order("occurred_at", { ascending: false }).limit(limit),
      "listRecentReceipts",
    ) ?? [];
  return rows.map(toReceiptSummary);
}
