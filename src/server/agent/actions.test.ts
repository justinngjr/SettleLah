import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveReceipt } from "@/app/app/_actions/receipts";
import type { Json } from "@/server/db";
import type { Row } from "@/server/telegram/fake-db.test-helpers";

import { approveAction, rejectAction } from "./actions";
import { resetToolModeCache, runTurn } from "./loop";
import { createAction, getAction, listActions, listMessages } from "./store";
import { agentWorld, deps, native, scriptedAgentLlm, toolCall, type AgentWorld } from "./test-helpers";
import { previewHash, ToolRegistry, type ToolContext, type WriteTool } from "./tools";

const hostMock = vi.hoisted(() => ({ requireHost: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/app/_lib/host", () => ({ requireHost: hostMock.requireHost }));

beforeEach(() => resetToolModeCache());

async function pendingAction(world: AgentWorld, tool: string, input: Record<string, unknown>, ctx: ToolContext = world.ctx()) {
  const registry = new ToolRegistry();
  const write = registry.getWrite(tool) as WriteTool;
  const preview = await write.preview(ctx, write.input.parse(input));
  return createAction(ctx.db, ctx.hostId, {
    conversationId: world.conversation(),
    toolCallId: "call_x",
    tool,
    input: input as NonNullable<Json>,
    preview,
    previewHash: previewHash(preview),
    now: world.clock.now,
  });
}

const strip = (row: Row, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

describe("approve", () => {
  it("records the payment once; approving again does nothing", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "record_payment", { friendId: world.ben.id, amount: "25", method: "cash" });
    expect(world.db.table("ledger_events").filter((e) => e.type === "payment")).toHaveLength(0);

    const first = await approveAction(world.ctx(), action.id);
    expect(first.kind).toBe("executed");
    if (first.kind !== "executed") return;
    expect(first.action.status).toBe("executed");
    expect(first.action.executedAt).not.toBeNull();
    expect(first.action.result).toMatchObject({ amount: "$25.00", balance: "holds $5.00 credit" });

    const payments = world.db.table("ledger_events").filter((e) => e.type === "payment");
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ friend_id: world.ben.id, amount: 2500 });
    expect(world.db.table("payment_claims")[0]).toMatchObject({ status: "confirmed", amount: 2500, source: "friend_button" });
    // Overpayment shows as credit: the request is paid and no new request is opened.
    expect(world.db.table("payment_requests").filter((r) => r.friend_id === world.ben.id).map((r) => r.status)).toEqual(["paid"]);

    const second = await approveAction(world.ctx(), action.id);
    expect(second.kind).toBe("already");
    expect(world.db.table("ledger_events").filter((e) => e.type === "payment")).toHaveLength(1);

    // The conversation learns about it as data, not as a host instruction.
    const messages = await listMessages(world.ctx().db, world.hostId, action.conversationId);
    expect(messages.at(-1)).toMatchObject({ role: "user", toolResult: { kind: "action_result", status: "executed" } });
  });

  it("concurrent approvals execute once", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "add_friend", { name: "Zed" });
    const outcomes = await Promise.all([approveAction(world.ctx(), action.id), approveAction(world.ctx(), action.id), approveAction(world.ctx(), action.id)]);
    expect(outcomes.filter((o) => o.kind === "executed")).toHaveLength(1);
    expect(world.db.table("friends").filter((f) => f.display_name === "Zed")).toHaveLength(1);
  });

  it("requires re-approval when the preview changed, then executes", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "record_payment", { friendId: world.ben.id, amount: "25" });
    // Ben gets $10 credit in the meantime: the "after" line would change.
    world.db.insert("ledger_events", { host_id: world.hostId, friend_id: world.ben.id, type: "credit", amount: 1000, created_by: "host" });

    const stale = await approveAction(world.ctx(), action.id);
    expect(stale.kind).toBe("stale_preview");
    if (stale.kind !== "stale_preview") return;
    expect(stale.action.status).toBe("pending");
    expect(stale.action.previewHash).not.toBe(action.previewHash);
    expect(stale.action.preview.rows.find((r) => r.label === "Owes now")?.value).toBe("owes $10.00");
    expect(world.db.table("ledger_events").filter((e) => e.type === "payment")).toHaveLength(0);

    const again = await approveAction(world.ctx(), action.id);
    expect(again.kind).toBe("executed");
    expect(world.db.table("ledger_events").filter((e) => e.type === "payment")).toHaveLength(1);
  });

  it("expires after 30 minutes", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "add_friend", { name: "Zed" });
    expect(new Date(action.expiresAt).getTime() - new Date(action.createdAt).getTime()).toBe(30 * 60 * 1000);
    world.clock.now = new Date(world.clock.now.getTime() + 31 * 60 * 1000);
    const outcome = await approveAction(world.ctx(), action.id);
    expect(outcome.kind).toBe("expired");
    expect((await getAction(world.ctx().db, world.hostId, action.id))?.status).toBe("expired");
    expect(world.db.table("friends").filter((f) => f.display_name === "Zed")).toHaveLength(0);
  });

  it("cannot be approved by another host", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "add_friend", { name: "Zed" });
    const outcome = await approveAction(world.ctx({ hostId: "00000000-0000-0000-0000-000000000bad" }), action.id);
    expect(outcome.kind).toBe("not_found");
    expect((await getAction(world.ctx().db, world.hostId, action.id))?.status).toBe("pending");
  });

  it("marks a failing tool as failed and tells the conversation", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "record_payment", { friendId: world.ben.id, amount: "25" });
    // The request disappears underneath: the preview fails to recompute.
    const request = world.db.table("payment_requests").find((r) => r.id === world.benRequest.id);
    Object.assign(request!, { status: "cancelled" });
    const outcome = await approveAction(world.ctx(), action.id);
    expect(outcome.kind).toBe("failed");
    const stored = await getAction(world.ctx().db, world.hostId, action.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toMatch(/no open payment request/);
  });

  it("reject marks the action rejected and informs the agent; rejecting twice is a no-op", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "add_friend", { name: "Zed" });
    const outcome = await rejectAction(world.ctx(), action.id);
    expect(outcome.kind).toBe("rejected");
    expect((await rejectAction(world.ctx(), action.id)).kind).toBe("already");
    const messages = await listMessages(world.ctx().db, world.hostId, action.conversationId);
    expect(messages.at(-1)?.content).toMatch(/declined/);
    expect(messages.at(-1)?.toolResult).toMatchObject({ kind: "action_result", status: "rejected" });
    expect(world.db.table("friends").filter((f) => f.display_name === "Zed")).toHaveLength(0);
  });

  it("sends Dan's reminder only on approval", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "send_reminder_now", { friendId: world.dan.id });
    expect(world.tg.calls).toHaveLength(0);
    const outcome = await approveAction(world.ctx(), action.id);
    expect(outcome.kind).toBe("executed");
    expect(world.tg.sentTo(444)).toHaveLength(1);
    expect(world.tg.sentTo(444)[0].payload.caption ?? world.tg.sentTo(444)[0].payload.text).toMatch(/Dan/);
    expect(world.db.table("reminders")[0]).toMatchObject({ payment_request_id: world.danRequest.id, stage: 1 });
  });
});

describe("recurring", () => {
  it("create_recurring: card shows the schedule; approval creates the expense with code-derived participants", async () => {
    const world = agentWorld();
    const action = await pendingAction(world, "create_recurring", {
      title: "Netflix",
      amount: "17.98",
      cadence: "monthly",
      anchorDay: 5,
      participantIds: ["host", world.sarah.id, world.dan.id],
    });
    expect(action.preview.title).toBe("Add recurring split: Netflix");
    expect(action.preview.rows).toEqual([
      { label: "Amount per run", value: "$17.98", strong: true },
      { label: "Schedule", value: "Monthly on the 5th" },
      { label: "Shared by", value: "You, Sarah, Dan" },
    ]);
    expect(world.db.table("recurring_expenses")).toHaveLength(0);
    const outcome = await approveAction(world.ctx(), action.id);
    if (outcome.kind === "failed") throw new Error(outcome.message);
    expect(outcome.kind).toBe("executed");
    const [row] = world.db.table("recurring_expenses");
    expect(row).toMatchObject({ host_id: world.hostId, title: "Netflix", amount: 1798, cadence: "monthly", anchor_day: 5, active: true });
    expect(row.participants).toEqual([
      { id: world.hostId, weight: 1 },
      { id: world.sarah.id, weight: 1 },
      { id: world.dan.id, weight: 1 },
    ]);

    const pause = await pendingAction(world, "pause_recurring", { recurringExpenseId: row.id });
    expect(pause.preview.title).toBe("Pause recurring split: Netflix");
    expect((await approveAction(world.ctx(), pause.id)).kind).toBe("executed");
    expect(world.db.table("recurring_expenses")[0]).toMatchObject({ active: false });
  });

  it("create_recurring rejects a bad day or a non-participant weight before making a card", async () => {
    const world = agentWorld();
    await expect(pendingAction(world, "create_recurring", { title: "Gym", amount: "10", cadence: "weekly", anchorDay: 7, participantIds: [world.ben.id] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      pendingAction(world, "create_recurring", { title: "Gym", amount: "10", cadence: "monthly", anchorDay: 1, participantIds: [world.ben.id], weights: { [world.dan.id as string]: 2 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("save_split parity with the Confirm screen", () => {
  it("approving the card writes the same rows as saveReceipt", async () => {
    const agent = agentWorld();
    const confirm = agentWorld();
    // Same host and friend ids in both worlds so rows compare directly.
    const ids = new Map<unknown, unknown>([
      [confirm.hostId, agent.hostId],
      [confirm.sarah.id, agent.sarah.id],
      [confirm.ben.id, agent.ben.id],
      [confirm.dan.id, agent.dan.id],
    ]);
    for (const rows of confirm.db.tables.values()) {
      for (const row of rows) for (const key of ["id", "host_id", "friend_id"]) if (ids.has(row[key])) row[key] = ids.get(row[key]);
    }
    Object.assign(confirm, { hostId: agent.hostId });
    const hostId = agent.hostId;
    const participantIds = ["host", agent.sarah.id, agent.ben.id];
    const items = [
      { label: "Chilli crab", price: "68.00", sharedBy: ["host", agent.sarah.id, agent.ben.id] },
      { label: "Lime juice x3", price: "9.00", sharedBy: ["host", agent.ben.id] },
    ];

    const action = await pendingAction(agent, "save_split", { title: "Dinner", participantIds, items, charges: "sc_gst", source: "manual" });
    const outcome = await approveAction(agent.ctx(), action.id);
    if (outcome.kind === "failed") throw new Error(outcome.message);
    expect(outcome.kind).toBe("executed");

    hostMock.requireHost.mockResolvedValue({ host: { id: hostId }, db: confirm.db.client() });
    const saved = await saveReceipt({
      title: "Dinner",
      source: "manual",
      participantIds: [hostId, agent.sarah.id, agent.ben.id],
      items: [
        { label: "Chilli crab", price: 6800, sharedBy: [hostId, agent.sarah.id, agent.ben.id] },
        { label: "Lime juice x3", price: 900, sharedBy: [hostId, agent.ben.id] },
      ],
      charges: "sc_gst",
      excluded: [],
      redistribute: "proportional",
      treatedBy: null,
      expectedTotal: 9232,
    });
    expect(saved).toMatchObject({ ok: true });

    const volatile = ["id", "created_at", "updated_at", "occurred_at", "receipt_id", "reference", "host_id"];
    const rows = (world: AgentWorld, table: string) => world.db.table(table).map((r) => strip(r, volatile));
    expect(rows(agent, "receipts")).toEqual(rows(confirm, "receipts"));
    expect(rows(agent, "receipt_shares")).toEqual(rows(confirm, "receipt_shares"));
    expect(rows(agent, "ledger_events")).toEqual(rows(confirm, "ledger_events"));
    expect(rows(agent, "payment_requests").map((r) => strip(r, ["cancelled_at", "paid_at"]))).toEqual(
      rows(confirm, "payment_requests").map((r) => strip(r, ["cancelled_at", "paid_at"])),
    );
    expect(agent.db.table("receipts")[0]).toMatchObject({ total: 9232, service_charge: 770, gst: 762 });
    // Ben: $20 before + $32.57 -> one open request for $52.57; Sarah: $27.18.
    const open = agent.db.table("payment_requests").filter((r) => r.status === "open");
    expect(open.map((r) => [r.friend_id, r.amount]).sort()).toEqual([[agent.ben.id, 5257], [agent.dan.id, 3000], [agent.sarah.id, 2718]].sort());
  });
});

describe("property: writes only ever run through approval", () => {
  // Small deterministic PRNG so failures reproduce.
  function rng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  it("over random tool-call sequences no write tool's run is invoked by the loop", async () => {
    const registry = new ToolRegistry();
    const writes = registry.tools.filter((t): t is WriteTool => t.kind === "write");
    const runs = new Map<string, number>();
    const originals = new Map(writes.map((t) => [t.name, t.run]));
    for (const tool of writes) {
      (tool as { run: WriteTool["run"] }).run = async (ctx, input) => {
        runs.set(tool.name, (runs.get(tool.name) ?? 0) + 1);
        return originals.get(tool.name)!.call(tool, ctx, input);
      };
    }
    try {
      const random = rng(20261023);
      for (let iteration = 0; iteration < 40; iteration++) {
        const world = agentWorld();
        const friendIds = [world.sarah.id, world.ben.id, world.dan.id] as string[];
        const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
        const argsFor = (name: string): unknown => {
          switch (name) {
            case "add_friend":
              return { name: pick(["Zed", "Yan", ""]) };
            case "rename_friend":
              return { friendId: pick(friendIds), name: "Renamed" };
            case "archive_friend":
              return { friendId: pick([...friendIds, "nope"]) };
            case "record_payment":
            case "add_credit":
              return { friendId: pick(friendIds), amount: pick(["25", "5.50", "abc", "-1"]) };
            case "send_reminder_now":
              return { friendId: pick(friendIds) };
            case "save_split":
              return {
                title: "Lunch",
                participantIds: ["host", world.ben.id],
                items: [{ label: "Noodles", price: pick(["12.00", "x"]), sharedBy: ["host", world.ben.id] }],
                charges: pick(["none", "gst"]),
              };
            case "resolve_friend":
              return { name: pick(["Ben", "Zed"]) };
            case "get_friend_ledger":
              return { friendId: pick(friendIds) };
            default:
              return pick([{}, { bogus: true }, { claimId: "nope", alertId: "nope", paymentRequestId: "nope", receiptId: "nope" }]);
          }
        };
        const steps = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
          const calls = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
            const tool = pick(registry.tools);
            return toolCall(tool.name, argsFor(tool.name));
          });
          return native("", ...calls);
        });
        const { llm } = scriptedAgentLlm([...steps, native("done")]);
        const conversationId = world.conversation();
        world.db.insert("agent_messages", { conversation_id: conversationId, host_id: world.hostId, role: "user", content: "random" });
        await runTurn(world.ctx(), deps(llm, { registry }), conversationId);
        expect([...runs.values()].reduce((a, b) => a + b, 0)).toBe(0);

        // Approving one pending card runs exactly that tool exactly once (or fails cleanly).
        const pending = (await listActions(world.ctx().db, world.hostId, conversationId)).filter((a) => a.status === "pending");
        if (pending.length === 0) continue;
        const chosen = pick(pending);
        const before = runs.get(chosen.tool) ?? 0;
        const outcome = await approveAction(world.ctx(), chosen.id, registry);
        const after = runs.get(chosen.tool) ?? 0;
        expect(after - before).toBe(outcome.kind === "executed" || (outcome.kind === "failed" && after > before) ? 1 : 0);
        expect([...runs.values()].reduce((a, b) => a + b, 0)).toBe(after - before);
        runs.clear();
      }
    } finally {
      for (const tool of writes) (tool as { run: WriteTool["run"] }).run = originals.get(tool.name)!;
    }
  });
});
