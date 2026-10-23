import { describe, expect, it } from "vitest";

import { formatSGD, MS_PER_HOUR } from "@/domain";

import { buttons, callbackUpdate, isPhoto, textOf, textUpdate, user } from "./fake-api.test-helpers";
import { listPendingBindings } from "./links";
import { TOAST } from "./messages";
import { notifySplit } from "./notify";
import { ALICE_TG, BOB_TG, CAROL_TG, GROUP_CHAT, HOST_TG, setup, type World } from "./setup.test-helpers";
import { createLinkToken } from "./tokens";

const alice = user(ALICE_TG, "alice", "Alice");
const bob = user(BOB_TG, "bob", "Bob");
const carol = user(CAROL_TG, "carol", "Carol");
const host = user(HOST_TG, "sarah", "Sarah");

async function split(w: World) {
  const result = await notifySplit({ hostId: w.hostId, receiptId: w.receiptId, telegramChatId: GROUP_CHAT }, w.deps);
  const requestFor = (friendId: unknown) => result.requests.find((r) => r.request.friendId === friendId)!.request;
  return { result, alice: requestFor(w.alice.id), bob: requestFor(w.bob.id), carol: requestFor(w.carol.id) };
}

describe("notifySplit", () => {
  it("posts one summary with mentions, That's-me buttons and the private-reminders link, then a QR per owing friend", async () => {
    const w = setup();
    const { result } = await split(w);

    const [summary] = w.tg.sent("sendMessage");
    expect(summary.payload.chat_id).toBe(GROUP_CHAT);
    expect(result.messageId).toBe(1);
    const text = textOf(summary);
    expect(text).toContain("Dinner at Jumbo");
    expect(text).toContain(formatSGD(12000));
    expect(text).toContain(`<a href="tg://user?id=${ALICE_TG}">Alice</a>: ${formatSGD(3000)}`);
    expect(text).toContain(`<a href="tg://user?id=${CAROL_TG}">Carol</a>`);
    expect(text).toContain("• Bob: ");
    expect(text).not.toContain(`tg://user?id=${BOB_TG}`);
    const keys = buttons(summary);
    expect(keys.filter((b) => b.callback_data?.startsWith("me:"))).toEqual([{ text: "That's me (Bob)", callback_data: `me:${w.bob.id}` }]);
    const link = keys.find((b) => b.text === "Get private reminders");
    expect(link?.url).toMatch(/^https:\/\/t\.me\/settlelah_bot\?start=fr_[A-Za-z0-9_-]{43}$/);

    const photos = w.tg.sent("sendPhoto");
    expect(photos).toHaveLength(3);
    expect(photos.every(isPhoto)).toBe(true);
    const toAlice = photos.find((p) => p.payload.chat_id === ALICE_TG)!;
    expect(toAlice.payload.reply_parameters).toBeUndefined();
    expect(textOf(toAlice)).toContain(`${formatSGD(3000)} · Ref SL`);
    expect(textOf(toAlice)).toContain("Pay Sarah Tan via PayNow");
    expect(buttons(toAlice).map((b) => b.text)).toEqual(["I've paid", "Remind me later"]);
    const inGroup = photos.filter((p) => p.payload.chat_id === GROUP_CHAT);
    expect(inGroup).toHaveLength(2);
    expect(inGroup.every((p) => (p.payload.reply_parameters as { message_id: number }).message_id === 1)).toBe(true);

    const requests = w.db.table("payment_requests");
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.receipt_id === w.receiptId && r.status === "open" && r.amount === 3000)).toBe(true);
    expect(w.db.table("reminders").map((r) => r.stage)).toEqual([1, 1, 1]);
    expect(w.db.table("receipts")[0].telegram_chat_id).toBe(GROUP_CHAT);
  });

  it("is idempotent for payment requests when posted twice", async () => {
    const w = setup();
    await split(w);
    await split(w);
    expect(w.db.table("payment_requests")).toHaveLength(3);
    expect(w.db.table("reminders")).toHaveLength(3);
  });

  it("falls back to the group and clears private_chat_started when the friend blocked the bot", async () => {
    const w = setup();
    w.tg.blocked.add(ALICE_TG);
    await split(w);
    const photos = w.tg.sent("sendPhoto");
    expect(photos.filter((p) => p.payload.chat_id === ALICE_TG)).toHaveLength(1);
    expect(photos.filter((p) => p.payload.chat_id === GROUP_CHAT)).toHaveLength(3);
    expect(w.db.table("friends").find((f) => f.id === w.alice.id)?.private_chat_started).toBe(false);
  });

  it("refuses chats that are not linked to the host", async () => {
    const w = setup();
    await expect(notifySplit({ hostId: w.hostId, receiptId: w.receiptId, telegramChatId: -42 }, w.deps)).rejects.toThrow(/not linked/);
  });
});

describe("binding", () => {
  it("That's me in the group asks the host; Approve binds the Telegram user", async () => {
    const w = setup();
    await split(w);
    w.tg.clear();

    await w.handle(callbackUpdate(bob, GROUP_CHAT, `me:${w.bob.id}`));
    const [prompt] = w.tg.sentTo(HOST_TG);
    expect(textOf(prompt)).toBe("Link @bob to Bob?");
    expect(buttons(prompt).map((b) => b.text)).toEqual(["Approve", "Reject"]);
    expect(w.tg.lastToast()).toContain("Waiting for your host");
    const [binding] = w.db.table("telegram_binding_requests");
    expect(binding.status).toBe("pending");
    expect(typeof binding.host_message_id).toBe("number");
    expect(w.db.table("friends").find((f) => f.id === w.bob.id)?.telegram_user_id).toBeNull();

    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[0].callback_data!));
    const bobRow = w.db.table("friends").find((f) => f.id === w.bob.id)!;
    expect(bobRow.telegram_user_id).toBe(BOB_TG);
    expect(bobRow.telegram_username).toBe("bob");
    expect(bobRow.private_chat_started).toBe(false);
    expect(binding.status).toBe("approved");
    expect(w.tg.lastToast()).toBe("Linked to Bob.");
  });

  it("Reject leaves the friend untouched and closes the request", async () => {
    const w = setup();
    await w.handle(callbackUpdate(bob, GROUP_CHAT, `me:${w.bob.id}`));
    const [prompt] = w.tg.sentTo(HOST_TG);
    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[1].callback_data!));
    const bobRow = w.db.table("friends").find((f) => f.id === w.bob.id)!;
    expect(bobRow.telegram_user_id).toBeNull();
    expect(w.db.table("telegram_binding_requests")[0].status).toBe("rejected");
    expect(w.tg.lastToast()).toContain("Rejected");
  });

  it("only the host can approve", async () => {
    const w = setup();
    await w.handle(callbackUpdate(bob, GROUP_CHAT, `me:${w.bob.id}`));
    const [prompt] = w.tg.sentTo(HOST_TG);
    await w.handle(callbackUpdate(carol, GROUP_CHAT, buttons(prompt)[0].callback_data!));
    expect(w.tg.lastToast()).toBe(TOAST.hostOnly);
    expect(w.db.table("telegram_binding_requests")[0].status).toBe("pending");
  });

  it("private deep link offers unbound friends and approval also enables private reminders", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "friend", { receiptId: w.receiptId, now: w.clock.now });
    await w.handle(textUpdate(bob, BOB_TG, `/start fr_${token}`));
    const [ask] = w.tg.sentTo(BOB_TG);
    expect(buttons(ask)).toEqual([{ text: "That's me (Bob)", callback_data: `me:${w.bob.id}` }]);

    await w.handle(callbackUpdate(bob, BOB_TG, `me:${w.bob.id}`));
    expect(w.db.table("telegram_binding_requests")[0].via_private_chat).toBe(true);
    const [prompt] = w.tg.sentTo(HOST_TG);
    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[0].callback_data!));
    const bobRow = w.db.table("friends").find((f) => f.id === w.bob.id)!;
    expect(bobRow.telegram_user_id).toBe(BOB_TG);
    expect(bobRow.private_chat_started).toBe(true);
    expect(w.tg.sentTo(BOB_TG).map(textOf).at(-1)).toContain("You're linked as Bob");
  });

  it("an already-bound friend using the private link just turns on private reminders", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "friend", { receiptId: w.receiptId, now: w.clock.now });
    await w.handle(textUpdate(carol, CAROL_TG, `/start fr_${token}`));
    expect(w.db.table("friends").find((f) => f.id === w.carol.id)?.private_chat_started).toBe(true);
    expect(w.db.table("telegram_binding_requests")).toHaveLength(0);
  });

  it("queues the request for the web inbox when the host has no Telegram, and prompts once the host links", async () => {
    const w = setup({ hostLinked: false });
    await w.handle(callbackUpdate(bob, GROUP_CHAT, `me:${w.bob.id}`));
    expect(w.tg.sent()).toHaveLength(0);
    expect(w.tg.lastToast()).toContain("SettleLah app");
    const pending = await listPendingBindings(w.hostId, w.deps);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ friendId: w.bob.id, telegramUserId: BOB_TG, hostMessageId: null, status: "pending" });

    const token = await createLinkToken(w.deps.db, w.hostId, "host", { now: w.clock.now });
    await w.handle(textUpdate(host, HOST_TG, `/start host_${token}`));
    expect(w.db.table("profiles")[0].telegram_user_id).toBe(HOST_TG);
    const prompts = w.tg.sentTo(HOST_TG).filter((c) => textOf(c).startsWith("Link "));
    expect(prompts).toHaveLength(1);
    expect(textOf(prompts[0])).toBe("Link @bob to Bob?");
    expect((await listPendingBindings(w.hostId, w.deps))[0].hostMessageId).not.toBeNull();
  });

  it("links a group through ?startgroup", async () => {
    const w = setup();
    const token = await createLinkToken(w.deps.db, w.hostId, "group", { now: w.clock.now });
    await w.handle(textUpdate(host, -555, `/start grp_${token}`, "New group"));
    expect(w.db.table("telegram_chats").find((c) => c.telegram_chat_id === -555)).toMatchObject({ host_id: w.hostId, title: "New group" });
    expect(textOf(w.tg.sentTo(-555)[0])).toContain("linked to Sarah Tan");
    await w.handle(textUpdate(host, -556, `/start grp_${token}`));
    expect(textOf(w.tg.sentTo(-556)[0])).toContain("expired");
  });
});

describe("friend actions", () => {
  it("I've paid creates a pending claim and asks the host; Confirm writes exactly one payment event", async () => {
    const w = setup();
    const { alice: request } = await split(w);
    w.tg.clear();

    await w.handle(callbackUpdate(alice, ALICE_TG, `paid:${request.id}`));
    const claims = w.db.table("payment_claims");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ payment_request_id: request.id, source: "friend_button", amount: null, status: "pending" });
    const [prompt] = w.tg.sentTo(HOST_TG);
    expect(textOf(prompt)).toContain(`Alice says they've paid ${formatSGD(3000)}`);
    expect(buttons(prompt).map((b) => b.text)).toEqual(["Confirm", "Not received"]);
    expect(w.db.table("ledger_events")).toHaveLength(0);

    await w.handle(callbackUpdate(alice, ALICE_TG, `paid:${request.id}`));
    expect(w.db.table("payment_claims")).toHaveLength(1);

    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[0].callback_data!));
    const events = w.db.table("ledger_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "payment", amount: 3000, friend_id: w.alice.id });
    expect(claims[0].status).toBe("confirmed");
    expect(w.db.table("payment_requests").find((r) => r.id === request.id)?.status).toBe("paid");
    expect(textOf(w.tg.sentTo(ALICE_TG).at(-1)!)).toContain("received your");

    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[0].callback_data!));
    expect(w.tg.lastToast()).toBe(TOAST.alreadyHandled);
    expect(w.db.table("ledger_events")).toHaveLength(1);
  });

  it("Not received rejects the claim and keeps the request open", async () => {
    const w = setup();
    const { alice: request } = await split(w);
    await w.handle(callbackUpdate(alice, ALICE_TG, `paid:${request.id}`));
    const prompt = w.tg.sentTo(HOST_TG).at(-1)!;
    await w.handle(callbackUpdate(host, HOST_TG, buttons(prompt)[1].callback_data!));
    expect(w.db.table("payment_claims")[0].status).toBe("rejected");
    expect(w.db.table("ledger_events")).toHaveLength(0);
    expect(w.db.table("payment_requests").find((r) => r.id === request.id)?.status).toBe("open");
    expect(textOf(w.tg.sentTo(ALICE_TG).at(-1)!)).toContain("hasn't received");
  });

  it("rejects buttons tapped by anyone but the bound friend", async () => {
    const w = setup();
    const { alice: aliceReq, bob: bobReq } = await split(w);
    await w.handle(callbackUpdate(carol, GROUP_CHAT, `paid:${aliceReq.id}`));
    expect(w.tg.lastToast()).toBe(TOAST.notYourRequest);
    await w.handle(callbackUpdate(bob, GROUP_CHAT, `paid:${bobReq.id}`));
    expect(w.tg.lastToast()).toBe(TOAST.notYourRequest);
    await w.handle(callbackUpdate(carol, GROUP_CHAT, `snooze:${aliceReq.id}`));
    expect(w.tg.lastToast()).toBe(TOAST.notYourRequest);
    expect(w.db.table("payment_claims")).toHaveLength(0);
    expect(w.db.table("reminders").every((r) => r.snoozed_until === null)).toBe(true);
  });

  it("Remind me later snoozes 24h via afterSnooze", async () => {
    const w = setup();
    const { alice: request } = await split(w);
    await w.handle(callbackUpdate(alice, ALICE_TG, `snooze:${request.id}`));
    const row = w.db.table("reminders").find((r) => r.payment_request_id === request.id)!;
    expect(row.snoozed_until).toBe(new Date(w.clock.now.getTime() + 24 * MS_PER_HOUR).toISOString());
    expect(w.tg.lastToast()).toContain("tomorrow");
  });
});
