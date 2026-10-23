import "server-only";

import { randomBytes } from "node:crypto";

import { normaliseBankName, type Cents } from "@/domain";
import type { DbClient, Enums, Tables, TablesInsert, TablesUpdate } from "@/server/db";
import { DbError, getFriend, UNIQUE_VIOLATION, updateFriend, type Friend } from "@/server/db";
import { unwrap, unwrapRequired } from "@/server/db/errors";

import { ReconcileError } from "./types";

export type BankAlertRow = Tables<"bank_alerts">;
export type BankAlertStatus = Enums<"bank_alert_status">;

export interface BankAlert {
  readonly id: string;
  readonly hostId: string;
  readonly bank: string;
  readonly receivedAt: string;
  readonly amount: Cents;
  readonly payerName: string | null;
  readonly reference: string | null;
  readonly sender: string | null;
  readonly subject: string | null;
  readonly status: BankAlertStatus;
  /** Why the alert is `ignored` / `unmatched` (e.g. `sender_not_verified`, `parse_failed`, `ambiguous`). */
  readonly reason: string | null;
  readonly proposedFriendId: string | null;
  readonly proposedPaymentRequestId: string | null;
  readonly matchConfidence: "strong" | "weak" | null;
  readonly matchReason: string | null;
  readonly createdAt: string;
}

export function toBankAlert(row: BankAlertRow): BankAlert {
  return {
    id: row.id,
    hostId: row.host_id,
    bank: row.bank,
    receivedAt: row.received_at,
    amount: row.amount,
    payerName: row.payer_name,
    reference: row.reference,
    sender: row.sender,
    subject: row.subject,
    status: row.status,
    reason: row.reason,
    proposedFriendId: row.proposed_friend_id,
    proposedPaymentRequestId: row.proposed_payment_request_id,
    matchConfidence: row.match_confidence === "strong" || row.match_confidence === "weak" ? row.match_confidence : null,
    matchReason: row.match_reason,
    createdAt: row.created_at,
  };
}

// inbound_email_routes --------------------------------------------------------

export const INBOUND_TOKEN_BYTES = 16;

export function generateInboundToken(random: (bytes: number) => Uint8Array = randomBytes): string {
  return Buffer.from(random(INBOUND_TOKEN_BYTES)).toString("hex");
}

export interface InboundRoute {
  readonly id: string;
  readonly hostId: string;
  readonly token: string;
  readonly createdAt: string;
}

function toRoute(row: Tables<"inbound_email_routes">): InboundRoute {
  return { id: row.id, hostId: row.host_id, token: row.token, createdAt: row.created_at };
}

/**
 * The host a forwarding token belongs to. This is the single lookup that is
 * not host-scoped (it *produces* the host id); every later query must filter
 * on the returned `hostId`. Revoked tokens resolve to nothing.
 */
export async function findRouteByToken(db: DbClient, token: string): Promise<InboundRoute | null> {
  const row = unwrap<Tables<"inbound_email_routes">>(
    await db.from("inbound_email_routes").select("*").eq("token", token).is("revoked_at", null).maybeSingle(),
    "findRouteByToken",
  );
  return row === null ? null : toRoute(row);
}

/** The host's active forwarding route, created on first call. */
export async function getOrCreateInboundRoute(
  db: DbClient,
  hostId: string,
  generateToken: () => string = generateInboundToken,
): Promise<InboundRoute> {
  const existing = unwrap<Tables<"inbound_email_routes">>(
    await db
      .from("inbound_email_routes")
      .select("*")
      .eq("host_id", hostId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    "getOrCreateInboundRoute",
  );
  if (existing) return toRoute(existing);
  const insert: TablesInsert<"inbound_email_routes"> = { host_id: hostId, token: generateToken() };
  const row = unwrapRequired<Tables<"inbound_email_routes">>(
    await db.from("inbound_email_routes").insert(insert).select("*").single(),
    "getOrCreateInboundRoute",
  );
  return toRoute(row);
}

// bank_alerts -----------------------------------------------------------------

export async function findBankAlertByHash(db: DbClient, hostId: string, rawHash: string): Promise<BankAlert | null> {
  const row = unwrap<BankAlertRow>(
    await db.from("bank_alerts").select("*").eq("host_id", hostId).eq("raw_hash", rawHash).maybeSingle(),
    "findBankAlertByHash",
  );
  return row === null ? null : toBankAlert(row);
}

export type NewBankAlert = Omit<TablesInsert<"bank_alerts">, "host_id" | "id" | "created_at">;

/**
 * Inserts an alert for the host. On a `(host_id, raw_hash)` collision (two
 * deliveries racing) returns the row that won, flagged `duplicate: true`.
 */
export async function insertBankAlert(
  db: DbClient,
  hostId: string,
  alert: NewBankAlert,
): Promise<{ alert: BankAlert; duplicate: boolean }> {
  const insert: TablesInsert<"bank_alerts"> = { ...alert, host_id: hostId };
  try {
    const row = unwrapRequired<BankAlertRow>(await db.from("bank_alerts").insert(insert).select("*").single(), "insertBankAlert");
    return { alert: toBankAlert(row), duplicate: false };
  } catch (error) {
    if (error instanceof DbError && error.code === UNIQUE_VIOLATION) {
      const existing = await findBankAlertByHash(db, hostId, alert.raw_hash);
      if (existing) return { alert: existing, duplicate: true };
    }
    throw error;
  }
}

export async function getBankAlert(db: DbClient, hostId: string, alertId: string): Promise<BankAlert | null> {
  const row = unwrap<BankAlertRow>(
    await db.from("bank_alerts").select("*").eq("host_id", hostId).eq("id", alertId).maybeSingle(),
    "getBankAlert",
  );
  return row === null ? null : toBankAlert(row);
}

export interface ListBankAlertsOptions {
  readonly status?: BankAlertStatus | readonly BankAlertStatus[];
  readonly limit?: number;
}

export async function listBankAlerts(db: DbClient, hostId: string, options: ListBankAlertsOptions = {}): Promise<BankAlert[]> {
  let query = db.from("bank_alerts").select("*").eq("host_id", hostId).order("received_at", { ascending: false });
  if (typeof options.status === "string") query = query.eq("status", options.status);
  else if (options.status !== undefined) query = query.in("status", [...options.status]);
  if (options.limit !== undefined) query = query.limit(options.limit);
  const rows = unwrap<BankAlertRow[]>(await query, "listBankAlerts") ?? [];
  return rows.map(toBankAlert);
}

export type BankAlertPatch = Pick<
  TablesUpdate<"bank_alerts">,
  "status" | "reason" | "proposed_friend_id" | "proposed_payment_request_id" | "match_confidence" | "match_reason"
>;

export async function updateBankAlert(db: DbClient, hostId: string, alertId: string, patch: BankAlertPatch): Promise<BankAlert> {
  const row = unwrapRequired<BankAlertRow>(
    await db.from("bank_alerts").update(patch).eq("host_id", hostId).eq("id", alertId).select("*").single(),
    "updateBankAlert",
  );
  return toBankAlert(row);
}

// profiles --------------------------------------------------------------------

export interface ReconcileSettings {
  readonly autoConfirmBankAlerts: boolean;
}

/** `profiles` is keyed by `id` = host id. A missing profile reads as the defaults. */
export async function getReconcileSettings(db: DbClient, hostId: string): Promise<ReconcileSettings> {
  const row = unwrap<Pick<Tables<"profiles">, "auto_confirm_bank_alerts">>(
    await db.from("profiles").select("auto_confirm_bank_alerts").eq("id", hostId).maybeSingle(),
    "getReconcileSettings",
  );
  return { autoConfirmBankAlerts: row?.auto_confirm_bank_alerts ?? false };
}

export async function updateReconcileSettings(
  db: DbClient,
  hostId: string,
  patch: Partial<ReconcileSettings>,
): Promise<ReconcileSettings> {
  const update: TablesUpdate<"profiles"> = {};
  if (patch.autoConfirmBankAlerts !== undefined) update.auto_confirm_bank_alerts = patch.autoConfirmBankAlerts;
  const row = unwrapRequired<Pick<Tables<"profiles">, "auto_confirm_bank_alerts">>(
    await db.from("profiles").update(update).eq("id", hostId).select("auto_confirm_bank_alerts").single(),
    "updateReconcileSettings",
  );
  return { autoConfirmBankAlerts: row.auto_confirm_bank_alerts };
}

// friends.known_bank_names ----------------------------------------------------

/** Remembers the bank's name for a friend after the host confirmed it. No-op when already known. */
export async function addKnownBankName(db: DbClient, hostId: string, friendId: string, payerName: string | null): Promise<Friend | null> {
  const name = payerName?.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const friend = await getFriend(db, hostId, friendId);
  if (!friend) throw new ReconcileError("not_found", `friend ${friendId} not found`);
  const wanted = normaliseBankName(name);
  if (friend.knownBankNames.some((known) => normaliseBankName(known) === wanted)) return friend;
  return updateFriend(db, hostId, friendId, { knownBankNames: [...friend.knownBankNames, name] });
}
