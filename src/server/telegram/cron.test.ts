import { describe, expect, it } from "vitest";

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, toSgt } from "@/domain";

import { isPhoto, textOf, type ApiCall } from "./fake-api.test-helpers";
import { notifySplit } from "./notify";
import { runReminders } from "./reminders";
import { ALICE_TG, GROUP_CHAT, HOST_TG, setup, T0, type World } from "./setup.test-helpers";

const TICK = 15 * MS_PER_MINUTE;

interface Sent {
  readonly at: Date;
  readonly call: ApiCall;
}

/** Runs the cron every 15 minutes from the current clock for `days`, collecting friend-facing sends. */
async function simulate(w: World, days: number): Promise<Sent[]> {
  const sent: Sent[] = [];
  const end = w.clock.now.getTime() + days * MS_PER_DAY;
  while (w.clock.now.getTime() <= end) {
    const before = w.tg.calls.length;
    await runReminders(w.deps);
    for (const call of w.tg.calls.slice(before)) {
      if ((call.method === "sendMessage" || call.method === "sendPhoto") && call.payload.chat_id !== HOST_TG) {
        sent.push({ at: new Date(w.clock.now), call });
      }
    }
    w.clock.now = new Date(w.clock.now.getTime() + TICK);
  }
  return sent;
}

async function split(w: World) {
  const result = await notifySplit({ hostId: w.hostId, receiptId: w.receiptId, telegramChatId: GROUP_CHAT }, w.deps);
  w.tg.clear();
  return result;
}

describe("reminder cron", () => {
  it("over a week sends exactly the stage-1 nudge two days after the split, without the QR", async () => {
    const w = setup();
    await split(w);
    const sent = await simulate(w, 8);
    expect(sent).toHaveLength(3);
    for (const s of sent) {
      expect(s.at.toISOString()).toBe(new Date(T0.getTime() + 2 * MS_PER_DAY).toISOString());
      expect(isPhoto(s.call)).toBe(false);
      expect(["Alice", "Bob", "Carol"].some((name) => textOf(s.call).includes(name))).toBe(true);
    }
    expect(sent.filter((s) => s.call.payload.chat_id === ALICE_TG)).toHaveLength(1);
    expect(sent.filter((s) => s.call.payload.chat_id === GROUP_CHAT)).toHaveLength(2);
    expect(w.db.table("reminders").map((r) => r.stage)).toEqual([2, 2, 2]);
  });

  it("sends stage 0 with the QR for requests the host raised outside Telegram, and respects quiet hours afterwards", async () => {
    const w = setup({ now: new Date("2026-03-02T15:00:00Z") });
    w.db.insert("payment_requests", {
      host_id: w.hostId,
      friend_id: w.alice.id,
      amount: 4500,
      reference: "SLQUIET1",
      receipt_id: w.receiptId,
      created_at: w.clock.now.toISOString(),
    });
    const sent = await simulate(w, 4);
    expect(sent).toHaveLength(2);
    expect(isPhoto(sent[0].call)).toBe(true);
    expect(sent[0].at.toISOString()).toBe("2026-03-02T15:00:00.000Z");
    expect(isPhoto(sent[1].call)).toBe(false);
    expect(sent[1].at.toISOString()).toBe("2026-03-05T02:00:00.000Z");
    expect(toSgt(sent[1].at).hour).toBe(10);
  });

  it("stops once the request is paid and pauses while a claim is pending", async () => {
    const w = setup();
    const { requests } = await split(w);
    const aliceReq = requests.find((r) => r.request.friendId === w.alice.id)!.request;
    const bobReq = requests.find((r) => r.request.friendId === w.bob.id)!.request;
    const claim = w.db.insert("payment_claims", { host_id: w.hostId, payment_request_id: aliceReq.id, source: "friend_button" });
    w.db.rpc("confirm_payment_claim", { p_claim_id: claim.id });
    w.db.insert("payment_claims", { host_id: w.hostId, payment_request_id: bobReq.id, source: "friend_button" });

    const sent = await simulate(w, 8);
    expect(sent.filter((s) => s.call.payload.chat_id === ALICE_TG)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(textOf(sent[0].call)).toContain("Carol");
    const summary = await runReminders(w.deps);
    expect(summary.counts.paused).toBe(1);
    expect(summary.scanned).toBe(2);
  });

  it("escalates to the host exactly once after the last stage", async () => {
    const w = setup();
    await split(w);
    w.clock.now = new Date(T0.getTime() + 45 * MS_PER_DAY);
    let escalated = 0;
    for (let i = 0; i < 12; i += 1) {
      const summary = await runReminders(w.deps);
      escalated += summary.counts.escalated;
      w.clock.now = new Date(w.clock.now.getTime() + MS_PER_HOUR);
    }
    expect(escalated).toBe(3);
    const hostDms = w.tg.sentTo(HOST_TG);
    expect(hostDms).toHaveLength(3);
    expect(hostDms.map(textOf).filter((t) => t.includes("Alice still hasn't paid"))).toHaveLength(1);
    expect(w.db.table("reminders").every((r) => r.stage === 7 && r.escalated_at !== null)).toBe(true);
  });

  it("concurrent invocations send each reminder once", async () => {
    const w = setup();
    await split(w);
    w.clock.now = new Date(T0.getTime() + 2 * MS_PER_DAY);
    const [a, b] = await Promise.all([runReminders(w.deps), runReminders(w.deps)]);
    expect(a.counts.sent + b.counts.sent).toBe(3);
    expect(a.counts.skipped + b.counts.skipped).toBe(3);
    expect(w.tg.sent()).toHaveLength(3);
    const again = await runReminders(w.deps);
    expect(again.counts.sent).toBe(0);
    expect(again.counts.waiting).toBe(3);
  });

  it("falls back to the group when a private reminder is blocked", async () => {
    const w = setup();
    await split(w);
    w.tg.blocked.add(ALICE_TG);
    w.clock.now = new Date(T0.getTime() + 2 * MS_PER_DAY);
    await runReminders(w.deps);
    expect(w.tg.sentTo(GROUP_CHAT)).toHaveLength(3);
    expect(w.db.table("friends").find((f) => f.id === w.alice.id)?.private_chat_started).toBe(false);
  });
});
