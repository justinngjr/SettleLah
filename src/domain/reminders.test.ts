import { describe, expect, it } from "vitest";

import { MoneyError } from "./money";
import {
  afterSent,
  afterSnooze,
  assertReminderState,
  createReminderState,
  dueAt,
  MAX_STAGE,
  nextReminder,
  nextSendWindow,
  reminderMessage,
  ReminderError,
  scheduledAt,
  SNOOZE_MS,
  type ReminderDecision,
  type ReminderState,
} from "./reminders";
import { fromSgt, MS_PER_DAY, MS_PER_HOUR } from "./sgt";

/** Asia/Singapore wall-clock -> instant, for readable timelines. */
const sgt = (iso: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso);
  if (!m) throw new Error(`bad test time ${iso}`);
  return fromSgt(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] === undefined ? 0 : +m[6]);
};
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

// Split at Friday 2026-03-06 19:30 SGT (inside the sending window).
const SPLIT = sgt("2026-03-06T19:30");
const base: ReminderState = createReminderState({ splitAt: SPLIT, hasPrivateChat: true });

describe("scheduledAt", () => {
  it.each([
    [0, "2026-03-06T19:30"],
    [1, "2026-03-08T19:30"],
    [2, "2026-03-15T19:30"],
    [3, "2026-03-22T19:30"],
    [6, "2026-04-12T19:30"],
    [7, "2026-04-19T19:30"],
  ])("stage %i is nominally due %s SGT", (stage, expected) => {
    expect(scheduledAt(SPLIT, stage).getTime()).toBe(sgt(expected).getTime());
  });

  it("rejects negative or fractional stages", () => {
    expect(() => scheduledAt(SPLIT, -1)).toThrow(ReminderError);
    expect(() => scheduledAt(SPLIT, 1.5)).toThrow(ReminderError);
  });
});

describe("nextSendWindow: quiet hours are 21:00-09:59 SGT", () => {
  it.each([
    ["2026-03-06T09:59", "2026-03-06T10:00"],
    ["2026-03-06T09:59:59", "2026-03-06T10:00"],
    ["2026-03-06T10:00", "2026-03-06T10:00"],
    ["2026-03-06T15:00", "2026-03-06T15:00"],
    ["2026-03-06T20:59", "2026-03-06T20:59"],
    ["2026-03-06T20:59:59", "2026-03-06T20:59:59"],
    ["2026-03-06T21:00", "2026-03-07T10:00"],
    ["2026-03-06T23:59", "2026-03-07T10:00"],
    ["2026-03-07T00:00", "2026-03-07T10:00"],
    ["2026-03-31T22:00", "2026-04-01T10:00"],
    ["2026-12-31T21:00", "2027-01-01T10:00"],
  ])("%s -> %s", (input, expected) => {
    expect(nextSendWindow(sgt(input)).getTime()).toBe(sgt(expected).getTime());
  });

  it("works in UTC terms too: 02:00Z is 10:00 SGT", () => {
    expect(nextSendWindow(new Date("2026-03-06T01:59:59Z")).toISOString()).toBe("2026-03-06T02:00:00.000Z");
    expect(nextSendWindow(new Date("2026-03-06T13:00:00Z")).toISOString()).toBe("2026-03-07T02:00:00.000Z");
  });
});

describe("nextReminder timelines", () => {
  const send = (at: string, stage: number, channel: "private" | "group" = "private"): ReminderDecision => ({
    kind: "send",
    at: sgt(at),
    stage,
    channel,
  });
  const wait = (until: string): ReminderDecision => ({ kind: "wait", until: sgt(until) });

  it("stage 0 is sent immediately when the split happens inside the window", () => {
    expect(nextReminder(base, SPLIT)).toEqual(send("2026-03-06T19:30", 0));
  });

  it("stage 0 is the host's split message: a 23:00 split sends at 23:00, stage 1 respects quiet hours", () => {
    const late = createReminderState({ splitAt: sgt("2026-03-06T23:00") });
    expect(nextReminder(late, sgt("2026-03-06T23:00"))).toEqual(send("2026-03-06T23:00", 0, "group"));
    const stage1 = afterSent(late, sgt("2026-03-06T23:00"));
    // nominal Sun 8 Mar 23:00 is in quiet hours -> Mon 9 Mar 10:00
    expect(nextReminder(stage1, sgt("2026-03-08T23:00"))).toEqual(wait("2026-03-09T10:00"));
    expect(nextReminder(stage1, sgt("2026-03-09T09:59"))).toEqual(wait("2026-03-09T10:00"));
    expect(nextReminder(stage1, sgt("2026-03-09T10:00"))).toEqual(send("2026-03-09T10:00", 1, "group"));
  });

  it("stage 0 sends immediately at every hour of the day", () => {
    for (let hour = 0; hour < 24; hour++) {
      const splitAt = sgt(`2026-03-06T${String(hour).padStart(2, "0")}:30`);
      expect(nextReminder(createReminderState({ splitAt }), splitAt)).toMatchObject({ kind: "send", stage: 0, at: splitAt });
    }
  });

  it("a snoozed stage 0 does respect quiet hours", () => {
    const late = createReminderState({ splitAt: sgt("2026-03-06T23:00") });
    const snoozed = afterSnooze(late, sgt("2026-03-06T23:05")); // -> 7 Mar 23:05, quiet -> 8 Mar 10:00
    expect(dueAt(snoozed).getTime()).toBe(sgt("2026-03-08T10:00").getTime());
    expect(nextReminder(snoozed, sgt("2026-03-07T23:05"))).toEqual(wait("2026-03-08T10:00"));
  });

  it("uses the group channel until the friend opens a private chat", () => {
    const groupOnly = { ...base, hasPrivateChat: false };
    expect(nextReminder(groupOnly, SPLIT)).toMatchObject({ kind: "send", channel: "group" });
    expect(nextReminder({ ...groupOnly, hasPrivateChat: true }, SPLIT)).toMatchObject({ kind: "send", channel: "private" });
  });

  it("walks the full schedule: split, +2d, then weekly, then escalates a week after the last", () => {
    // [now, expected decision, then act?]
    const timeline: ReadonlyArray<[string, ReminderDecision]> = [
      ["2026-03-06T19:30", send("2026-03-06T19:30", 0)],
      ["2026-03-07T12:00", wait("2026-03-08T19:30")],
      ["2026-03-08T19:29", wait("2026-03-08T19:30")],
      ["2026-03-08T19:30", send("2026-03-08T19:30", 1)],
      ["2026-03-10T12:00", wait("2026-03-15T19:30")],
      ["2026-03-15T19:30", send("2026-03-15T19:30", 2)],
      ["2026-03-22T19:30", send("2026-03-22T19:30", 3)],
      ["2026-03-29T19:30", send("2026-03-29T19:30", 4)],
      ["2026-04-05T19:30", send("2026-04-05T19:30", 5)],
      ["2026-04-12T19:30", send("2026-04-12T19:30", 6)],
      ["2026-04-12T19:31", wait("2026-04-19T19:30")],
      ["2026-04-19T19:29", wait("2026-04-19T19:30")],
      ["2026-04-19T19:30", { kind: "escalate_to_host" }],
      ["2026-06-01T12:00", { kind: "escalate_to_host" }],
    ];
    let state = base;
    for (const [at, expected] of timeline) {
      const decision = nextReminder(state, sgt(at));
      expect(decision, `at ${at}`).toEqual(expected);
      if (decision.kind === "send") state = afterSent(state, decision.at);
    }
    expect(state.stage).toBe(MAX_STAGE + 1);
    expect(() => afterSent(state, sgt("2026-04-19T19:30"))).toThrow(ReminderError);
  });

  it("a weekly stage landing in quiet hours moves to the next 10:00", () => {
    const night = createReminderState({ splitAt: sgt("2026-03-06T21:00"), hasPrivateChat: true });
    // stage 0 -> Fri 21:00 immediately; stage 1 nominal Sun 21:00 -> Mon 10:00; stage 2 nominal Sun 15 Mar 21:00 -> Mon 16 Mar 10:00
    let state = night;
    const d0 = nextReminder(state, sgt("2026-03-06T21:00"));
    expect(d0).toEqual(send("2026-03-06T21:00", 0));
    state = afterSent(state, sgt("2026-03-06T21:00"));
    expect(nextReminder(state, sgt("2026-03-08T21:00"))).toEqual(wait("2026-03-09T10:00"));
    const d1 = nextReminder(state, sgt("2026-03-09T10:00"));
    expect(d1).toEqual(send("2026-03-09T10:00", 1));
    state = afterSent(state, sgt("2026-03-09T10:00"));
    expect(nextReminder(state, sgt("2026-03-15T21:30"))).toEqual(wait("2026-03-16T10:00"));
  });

  it("reports the due time, not `now`, when a reminder is overdue", () => {
    expect(nextReminder(base, sgt("2026-03-06T20:45"))).toEqual(send("2026-03-06T19:30", 0));
    const stage1 = afterSent(base, SPLIT);
    expect(nextReminder(stage1, sgt("2026-03-20T12:00"))).toEqual(send("2026-03-08T19:30", 1));
  });
});

describe("snooze", () => {
  it("'remind me later' pushes the next reminder 24h from the tap", () => {
    const stage1 = afterSent(base, SPLIT); // nominal Sun 8 Mar 19:30
    const snoozed = afterSnooze(stage1, sgt("2026-03-08T19:35"));
    expect(snoozed.snoozedUntil?.getTime()).toBe(sgt("2026-03-09T19:35").getTime());
    expect(nextReminder(snoozed, sgt("2026-03-09T19:34"))).toEqual({ kind: "wait", until: sgt("2026-03-09T19:35") });
    expect(nextReminder(snoozed, sgt("2026-03-09T19:35"))).toMatchObject({ kind: "send", stage: 1, at: sgt("2026-03-09T19:35") });
  });

  it("a snooze never moves a reminder earlier than its scheduled time", () => {
    const stage1 = afterSent(base, SPLIT); // nominal Sun 8 Mar 19:30
    const early = afterSnooze(stage1, sgt("2026-03-06T20:00")); // tap right after stage 0 -> 7 Mar 20:00 < nominal
    expect(dueAt(early).getTime()).toBe(sgt("2026-03-08T19:30").getTime());
    expect(nextReminder(early, sgt("2026-03-07T20:00"))).toEqual({ kind: "wait", until: sgt("2026-03-08T19:30") });
  });

  it("a snooze that lands in quiet hours waits for the next 10:00", () => {
    const stage1 = afterSent(base, SPLIT);
    const snoozed = afterSnooze(stage1, sgt("2026-03-08T22:30")); // -> 9 Mar 22:30, quiet -> 10 Mar 10:00
    expect(dueAt(snoozed).getTime()).toBe(sgt("2026-03-10T10:00").getTime());
  });

  it("tapping twice keeps the later snooze", () => {
    const stage1 = afterSent(base, SPLIT);
    const twice = afterSnooze(afterSnooze(stage1, sgt("2026-03-09T12:00")), sgt("2026-03-09T11:00"));
    expect(twice.snoozedUntil?.getTime()).toBe(sgt("2026-03-10T12:00").getTime());
  });

  it("the snooze is consumed once the reminder is sent and does not delay later stages", () => {
    const stage1 = afterSent(base, SPLIT);
    const snoozed = afterSnooze(stage1, sgt("2026-03-14T12:00")); // until 15 Mar 12:00
    const sent = afterSent(snoozed, sgt("2026-03-15T12:00"));
    expect(sent.snoozedUntil).toBeUndefined();
    expect(sent.lastSentAt?.getTime()).toBe(sgt("2026-03-15T12:00").getTime());
    expect(dueAt(sent).getTime()).toBe(sgt("2026-03-15T19:30").getTime());
  });

  it("SNOOZE_MS is 24 hours", () => {
    expect(SNOOZE_MS).toBe(24 * MS_PER_HOUR);
    expect(MS_PER_DAY).toBe(SNOOZE_MS);
  });
});

describe("status changes mid-schedule", () => {
  const stage3 = { ...base, stage: 3 };

  it("stops as soon as the request is paid or cancelled, whatever the stage or snooze", () => {
    expect(nextReminder({ ...stage3, status: "paid" }, sgt("2026-03-22T19:30"))).toEqual({ kind: "done" });
    expect(nextReminder({ ...stage3, status: "cancelled" }, sgt("2026-03-01T00:00"))).toEqual({ kind: "done" });
    expect(nextReminder({ ...base, stage: MAX_STAGE + 1, status: "paid" }, sgt("2026-05-01T12:00"))).toEqual({ kind: "done" });
    expect(nextReminder(afterSnooze({ ...stage3, status: "paid" }, SPLIT), plus(SPLIT, 2 * MS_PER_DAY))).toEqual({ kind: "done" });
  });

  it("pauses while a payment claim awaits the host", () => {
    expect(nextReminder({ ...stage3, status: "claim_pending" }, sgt("2026-03-22T19:30"))).toEqual({ kind: "paused" });
    expect(nextReminder({ ...base, stage: MAX_STAGE + 1, status: "claim_pending" }, sgt("2026-05-01T12:00"))).toEqual({
      kind: "paused",
    });
  });

  it("resumes where it left off when a claim is rejected", () => {
    const paused = { ...stage3, status: "claim_pending" as const };
    const resumed = { ...paused, status: "open" as const };
    expect(nextReminder(resumed, sgt("2026-03-22T19:30"))).toMatchObject({ kind: "send", stage: 3 });
  });
});

describe("state validation", () => {
  it("createReminderState defaults to open, stage 0, group channel", () => {
    expect(createReminderState({ splitAt: SPLIT })).toEqual({ splitAt: SPLIT, status: "open", hasPrivateChat: false, stage: 0 });
    expect(() => createReminderState({ splitAt: new Date("nope") })).toThrow(RangeError);
  });

  it("rejects malformed states", () => {
    expect(() => assertReminderState({ ...base, stage: -1 })).toThrow(ReminderError);
    expect(() => assertReminderState({ ...base, stage: 1.5 })).toThrow(ReminderError);
    expect(() => assertReminderState({ ...base, status: "lost" as never })).toThrow(ReminderError);
    expect(() => assertReminderState({ ...base, hasPrivateChat: "yes" as never })).toThrow(ReminderError);
    expect(() => assertReminderState({ ...base, snoozedUntil: new Date("nope") })).toThrow(RangeError);
    expect(() => nextReminder(base, new Date(Number.NaN))).toThrow(RangeError);
    expect(() => afterSnooze(base, new Date(Number.NaN))).toThrow(RangeError);
  });

  it("never mutates the input state", () => {
    const frozen = Object.freeze({ ...base });
    afterSent(frozen, SPLIT);
    afterSnooze(frozen, SPLIT);
    nextReminder(frozen, SPLIT);
    expect(frozen).toEqual(base);
  });
});

describe("reminderMessage", () => {
  const input = { stage: 1, friendName: "Sarah", amount: 2216, hostName: "Alex" };

  it("every stage mentions the friend, the host and the exact amount", () => {
    for (let stage = 0; stage <= MAX_STAGE; stage++) {
      const text = reminderMessage({ ...input, stage });
      expect(text).toContain("Sarah");
      expect(text).toContain("Alex");
      expect(text).toContain("$22.16");
      expect(text.length).toBeLessThan(200);
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it("copy differs between stages and the last stage says the bot is stopping", () => {
    const texts = Array.from({ length: MAX_STAGE + 1 }, (_, stage) => reminderMessage({ ...input, stage }));
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[0]).toMatch(/no rush/i);
    expect(texts[MAX_STAGE]).toMatch(/last reminder/i);
  });

  it("never guilt-trips", () => {
    for (let stage = 0; stage <= MAX_STAGE; stage++) {
      expect(reminderMessage({ ...input, stage })).not.toMatch(/overdue|immediately|urgent|must|late fee|final warning/i);
    }
  });

  it("validates its input", () => {
    expect(() => reminderMessage({ ...input, stage: MAX_STAGE + 1 })).toThrow(ReminderError);
    expect(() => reminderMessage({ ...input, stage: -1 })).toThrow(ReminderError);
    expect(() => reminderMessage({ ...input, friendName: " " })).toThrow(ReminderError);
    expect(() => reminderMessage({ ...input, hostName: "" })).toThrow(ReminderError);
    expect(() => reminderMessage({ ...input, amount: 12.5 })).toThrow(MoneyError);
    expect(() => reminderMessage({ ...input, amount: -1 })).toThrow(MoneyError);
  });
});
