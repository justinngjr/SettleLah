import "server-only";

import type { DbClient } from "./client";
import type { Tables, TablesInsert, TablesUpdate } from "./database.types";
import { unwrap, unwrapRequired } from "./errors";

export type FriendRow = Tables<"friends">;

/** A friend of the host. Friends never have accounts; they are host-owned records. */
export interface Friend {
  readonly id: string;
  readonly hostId: string;
  readonly displayName: string;
  readonly telegramUserId: number | null;
  readonly telegramUsername: string | null;
  readonly privateChatStarted: boolean;
  readonly knownBankNames: readonly string[];
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewFriend {
  readonly displayName: string;
  readonly telegramUserId?: number | null;
  readonly telegramUsername?: string | null;
  readonly knownBankNames?: readonly string[];
}

export interface FriendPatch extends Partial<NewFriend> {
  readonly privateChatStarted?: boolean;
}

export function toFriend(row: FriendRow): Friend {
  return {
    id: row.id,
    hostId: row.host_id,
    displayName: row.display_name,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    privateChatStarted: row.private_chat_started,
    knownBankNames: row.known_bank_names,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUpdate(patch: FriendPatch): TablesUpdate<"friends"> {
  const update: TablesUpdate<"friends"> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.telegramUserId !== undefined) update.telegram_user_id = patch.telegramUserId;
  if (patch.telegramUsername !== undefined) update.telegram_username = patch.telegramUsername;
  if (patch.knownBankNames !== undefined) update.known_bank_names = [...patch.knownBankNames];
  if (patch.privateChatStarted !== undefined) update.private_chat_started = patch.privateChatStarted;
  return update;
}

export interface ListFriendsOptions {
  /** Archived friends are hidden by default. */
  readonly includeArchived?: boolean;
}

export async function listFriends(db: DbClient, hostId: string, options: ListFriendsOptions = {}): Promise<Friend[]> {
  let query = db.from("friends").select("*").eq("host_id", hostId).order("display_name", { ascending: true });
  if (!options.includeArchived) query = query.eq("archived", false);
  const rows = unwrap(await query, "listFriends") ?? [];
  return rows.map(toFriend);
}

export async function getFriend(db: DbClient, hostId: string, friendId: string): Promise<Friend | null> {
  const row = unwrap(
    await db.from("friends").select("*").eq("host_id", hostId).eq("id", friendId).maybeSingle(),
    "getFriend",
  );
  return row === null ? null : toFriend(row);
}

export async function createFriend(db: DbClient, hostId: string, input: NewFriend): Promise<Friend> {
  const insert: TablesInsert<"friends"> = {
    host_id: hostId,
    display_name: input.displayName,
    telegram_user_id: input.telegramUserId ?? null,
    telegram_username: input.telegramUsername ?? null,
    known_bank_names: [...(input.knownBankNames ?? [])],
  };
  const row = unwrapRequired(await db.from("friends").insert(insert).select("*").single(), "createFriend");
  return toFriend(row);
}

export async function updateFriend(db: DbClient, hostId: string, friendId: string, patch: FriendPatch): Promise<Friend> {
  const row = unwrapRequired(
    await db.from("friends").update(toUpdate(patch)).eq("host_id", hostId).eq("id", friendId).select("*").single(),
    "updateFriend",
  );
  return toFriend(row);
}

/**
 * Friends are never hard-deleted: their ledger history must survive. Archiving
 * hides them from pickers; an archived friend with a non-zero balance still
 * shows up in `listBalances`.
 */
export async function archiveFriend(db: DbClient, hostId: string, friendId: string): Promise<Friend> {
  return setArchived(db, hostId, friendId, true);
}

export async function unarchiveFriend(db: DbClient, hostId: string, friendId: string): Promise<Friend> {
  return setArchived(db, hostId, friendId, false);
}

async function setArchived(db: DbClient, hostId: string, friendId: string, archived: boolean): Promise<Friend> {
  const row = unwrapRequired(
    await db.from("friends").update({ archived }).eq("host_id", hostId).eq("id", friendId).select("*").single(),
    archived ? "archiveFriend" : "unarchiveFriend",
  );
  return toFriend(row);
}
