import "server-only";

import { formatSGD, fromDollars, MoneyError, type Cents } from "@/domain";
import { getFriend, listBalances, listFriends, type Friend } from "@/server/db";

import { ToolError, type ToolContext } from "./types";

/** The model may say "host" instead of the host's id; everything else must be a friend id. */
export const HOST_ALIAS = "host";

export function participantId(ctx: ToolContext, id: string): string {
  return id === HOST_ALIAS ? ctx.hostId : id;
}

/** Parses a printed dollar string ("12.30"); the only way money enters a tool. */
export function cents(printed: string, label = "amount"): Cents {
  try {
    const value = fromDollars(printed);
    if (value <= 0) throw new ToolError("invalid_input", `${label} must be greater than zero, got "${printed}"`);
    return value;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (error instanceof MoneyError) throw new ToolError("invalid_input", `${label}: ${error.message}`);
    throw error;
  }
}

export async function requireFriend(ctx: ToolContext, friendId: string): Promise<Friend> {
  const friend = await getFriend(ctx.db, ctx.hostId, friendId);
  if (!friend) throw new ToolError("not_found", `no friend with id ${friendId}; use resolve_friend to find the id`);
  return friend;
}

/** Display names for participant ids, with the host shown as "You". */
export async function participantNames(ctx: ToolContext, ids: readonly string[]): Promise<Map<string, string>> {
  const friends = await listFriends(ctx.db, ctx.hostId, { includeArchived: true });
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  names.set(ctx.hostId, "You");
  for (const id of ids) {
    if (!names.has(id)) throw new ToolError("not_found", `unknown participant id ${id}; use resolve_friend / list_friends`);
  }
  return names;
}

export async function friendBalance(ctx: ToolContext, friendId: string): Promise<Cents> {
  const balances = await listBalances(ctx.db, ctx.hostId);
  return balances.find((b) => b.friend.id === friendId)?.balance ?? 0;
}

/** "owes $12.30" / "holds $1.00 credit" / "settled". */
export function describeBalance(balance: Cents): string {
  if (balance > 0) return `owes ${formatSGD(balance)}`;
  if (balance < 0) return `holds ${formatSGD(-balance)} credit`;
  return "settled";
}

export function summarizeFriend(friend: Friend) {
  return { id: friend.id, name: friend.displayName, archived: friend.archived, telegramLinked: friend.telegramUserId !== null };
}
