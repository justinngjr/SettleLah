import "server-only";

import { listChats, listPendingBindingRows, type BindingRequest, type LinkedChat } from "./db";
import { depsFromEnv, type TelegramDeps } from "./deps";
import { createLinkToken, groupLinkUrl, hostLinkUrl } from "./tokens";

/**
 * Server functions for the host UI (called from server actions / route
 * handlers with the signed-in host's id). `deps` defaults to the production
 * wiring and is injected in tests.
 */

/** `https://t.me/<bot>?start=host_<token>`: the host taps it to link their own Telegram account. */
export async function createHostLinkToken(hostId: string, deps: TelegramDeps = depsFromEnv()): Promise<string> {
  const token = await createLinkToken(deps.db, hostId, "host", { now: deps.now() });
  return hostLinkUrl(deps.botUsername, token);
}

/** `https://t.me/<bot>?startgroup=grp_<token>`: adds the bot to a group and links that group to the host. */
export async function createGroupLinkToken(hostId: string, deps: TelegramDeps = depsFromEnv()): Promise<string> {
  const token = await createLinkToken(deps.db, hostId, "group", { now: deps.now() });
  return groupLinkUrl(deps.botUsername, token);
}

export async function listLinkedChats(hostId: string, deps: TelegramDeps = depsFromEnv()): Promise<LinkedChat[]> {
  return listChats(deps.db, hostId);
}

/** Binding requests waiting for the host's approval (the web inbox shows these when the host has no Telegram DM). */
export async function listPendingBindings(hostId: string, deps: TelegramDeps = depsFromEnv()): Promise<BindingRequest[]> {
  return listPendingBindingRows(deps.db, hostId);
}
