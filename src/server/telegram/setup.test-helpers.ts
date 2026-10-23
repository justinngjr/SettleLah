import { randomUUID } from "node:crypto";

import { createBot } from "./bot";
import { createDeps, type TelegramDeps } from "./deps";
import type { TelegramConfig } from "./env";
import { FakeTelegram } from "./fake-api.test-helpers";
import { FakeDb, type Row } from "./fake-db.test-helpers";

export const CONFIG: TelegramConfig = { token: "123456:TEST-TOKEN", username: "settlelah_bot", webhookSecret: "whsec-test" };

export const GROUP_CHAT = -1001234567;
export const HOST_TG = 999;
export const ALICE_TG = 111;
export const CAROL_TG = 333;
export const BOB_TG = 222;

/** Monday 2026-03-02 12:00 Asia/Singapore. */
export const T0 = new Date("2026-03-02T04:00:00Z");

export interface World {
  readonly db: FakeDb;
  readonly tg: FakeTelegram;
  readonly deps: TelegramDeps;
  readonly clock: { now: Date };
  readonly hostId: string;
  readonly receiptId: string;
  readonly alice: Row;
  readonly bob: Row;
  readonly carol: Row;
  handle(update: unknown): Promise<void>;
  linkHost(): void;
}

export function setup(options: { hostLinked?: boolean; now?: Date } = {}): World {
  const db = new FakeDb();
  const tg = new FakeTelegram();
  const clock = { now: options.now ?? T0 };
  db.now = () => clock.now;
  const deps = createDeps(CONFIG, { db: db.client(), transformer: tg.transformer, now: () => clock.now });
  const bot = createBot(deps);

  const hostId = randomUUID();
  db.insert("profiles", {
    id: hostId,
    display_name: "Sarah",
    paynow_display_name: "Sarah Tan",
    paynow_proxy_type: "mobile",
    paynow_proxy_value: "91234567",
    telegram_user_id: options.hostLinked === false ? null : HOST_TG,
    telegram_username: options.hostLinked === false ? null : "sarah",
  });
  db.insert("telegram_chats", { host_id: hostId, telegram_chat_id: GROUP_CHAT, title: "Dinner gang" });
  const alice = db.insert("friends", {
    host_id: hostId,
    display_name: "Alice",
    telegram_user_id: ALICE_TG,
    telegram_username: "alice",
    private_chat_started: true,
  });
  const bob = db.insert("friends", { host_id: hostId, display_name: "Bob" });
  const carol = db.insert("friends", { host_id: hostId, display_name: "Carol", telegram_user_id: CAROL_TG, telegram_username: "carol" });
  const receipt = db.insert("receipts", {
    host_id: hostId,
    title: "Dinner at Jumbo",
    total: 12000,
    subtotal: 10000,
    gst: 900,
    gst_bps: 900,
    service_charge: 1000,
    service_charge_bps: 1000,
    source: "manual",
    split_input: {},
  });
  for (const [friend, amount] of [
    [alice, 3000],
    [bob, 3000],
    [carol, 3000],
  ] as const) {
    db.insert("receipt_shares", { host_id: hostId, receipt_id: receipt.id, friend_id: friend.id, amount });
  }
  db.insert("receipt_shares", { host_id: hostId, receipt_id: receipt.id, friend_id: null, amount: 3000 });

  return {
    db,
    tg,
    deps,
    clock,
    hostId,
    receiptId: receipt.id as string,
    alice,
    bob,
    carol,
    handle: (update) => bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]),
    linkHost: () => {
      const profile = db.table("profiles").find((p) => p.id === hostId);
      if (profile) Object.assign(profile, { telegram_user_id: HOST_TG, telegram_username: "sarah" });
    },
  };
}

export function advance(world: World, ms: number): void {
  world.clock.now = new Date(world.clock.now.getTime() + ms);
}
