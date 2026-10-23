import "server-only";

import { z } from "zod";

import { formatSGD } from "@/domain";
import { createRecurring, getRecurring, listRecurring, pauseRecurring, RecurringInputError, type RecurringExpense } from "@/server/db";

import { cents, participantId, participantNames } from "./helpers";
import type { ActionPreview } from "./preview";
import { readTool, ToolError, writeTool, type ToolContext } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

export function describeCadence(cadence: "monthly" | "weekly", anchorDay: number): string {
  return cadence === "monthly" ? `Monthly on the ${ordinal(anchorDay)}` : `Weekly on ${WEEKDAYS[anchorDay] ?? `day ${anchorDay}`}`;
}

async function describeRecurring(ctx: ToolContext, expense: RecurringExpense) {
  const ids = expense.participants.map((p) => p.id);
  const names = await participantNames(ctx, []);
  return {
    id: expense.id,
    title: expense.title,
    amount: formatSGD(expense.amount),
    cadence: expense.cadence,
    anchorDay: expense.anchorDay,
    schedule: describeCadence(expense.cadence, expense.anchorDay),
    participants: expense.participants.map((p) => ({ id: p.id, name: p.id === ctx.hostId ? "You" : (names.get(p.id) ?? "(unknown)"), weight: p.weight })),
    active: expense.active,
    nextRunAt: expense.nextRunAt,
    postsToTelegramChatId: expense.telegramChatId,
    participantIds: ids,
  };
}

export const listRecurringTool = readTool({
  name: "list_recurring",
  description: "Recurring splits (e.g. Netflix monthly on the 5th) with ids, schedule, amount, participants and whether they are active.",
  kind: "read",
  input: z.object({ activeOnly: z.boolean().optional() }),
  async run(ctx, input) {
    const expenses = await listRecurring(ctx.db, ctx.hostId, { activeOnly: input.activeOnly ?? false });
    return { recurring: await Promise.all(expenses.map((e) => describeRecurring(ctx, e))) };
  },
});

/** Weights keyed by participant id (or "host"), defaulting to 1; every key must be a participant. */
function resolveWeights(ctx: ToolContext, ids: readonly string[], weights: Readonly<Record<string, number>> | undefined): Map<string, number> {
  const resolved = new Map(ids.map((id) => [id, 1]));
  for (const [key, weight] of Object.entries(weights ?? {})) {
    const id = participantId(ctx, key);
    if (!resolved.has(id)) throw new ToolError("invalid_input", `weights: ${key} is not a participant`);
    resolved.set(id, weight);
  }
  return resolved;
}

export const CreateRecurringInputSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("e.g. Netflix"),
  amount: z.string().trim().min(1).describe('Total amount per run in dollars as the host said it, e.g. "17.98"'),
  cadence: z.enum(["monthly", "weekly"]),
  anchorDay: z.number().int().describe("monthly: day of month 1-31; weekly: 0 = Sunday … 6 = Saturday"),
  participantIds: z.array(z.string().min(1)).min(1).describe('Who shares it: friend ids plus "host" if the host pays a share'),
  weights: z.record(z.string(), z.number().int().positive()).optional().describe("Optional relative shares keyed by participant id; default equal"),
  telegramChatId: z.number().int().optional().describe("Linked group to post each run to; omit for none"),
});

export const createRecurringTool = writeTool({
  name: "create_recurring",
  description:
    "Create a recurring split that charges the participants on a schedule. The amount is the total per run; code splits it by the weights (equal by default) and the host never absorbs rounding.",
  kind: "write",
  input: CreateRecurringInputSchema,
  async preview(ctx, input): Promise<ActionPreview> {
    const amount = cents(input.amount);
    const ids = Array.from(new Set(input.participantIds.map((id) => participantId(ctx, id))));
    const names = await participantNames(ctx, ids);
    if (input.cadence === "monthly" ? input.anchorDay < 1 || input.anchorDay > 31 : input.anchorDay < 0 || input.anchorDay > 6) {
      throw new ToolError("invalid_input", input.cadence === "monthly" ? "anchorDay must be 1-31 for monthly" : "anchorDay must be 0-6 for weekly");
    }
    const weights = resolveWeights(ctx, ids, input.weights);
    const label = (id: string) => (id === ctx.hostId ? "You" : (names.get(id) ?? id));
    const shares = ids.map((id) => `${label(id)}${weights.get(id) !== 1 ? ` ×${weights.get(id)}` : ""}`);
    return {
      title: `Add recurring split: ${input.title}`,
      summary: `Every run splits ${formatSGD(amount)} between ${ids.length} ${ids.length === 1 ? "person" : "people"} and opens payment requests for friends who owe.`,
      rows: [
        { label: "Amount per run", value: formatSGD(amount), strong: true },
        { label: "Schedule", value: describeCadence(input.cadence, input.anchorDay) },
        { label: "Shared by", value: shares.join(", ") },
        ...(input.telegramChatId !== undefined ? [{ label: "Posts to", value: `Telegram chat ${input.telegramChatId}` }] : []),
      ],
      openInApp: "/app/settings",
    };
  },
  async run(ctx, input) {
    const amount = cents(input.amount);
    const ids = Array.from(new Set(input.participantIds.map((id) => participantId(ctx, id))));
    const weights = resolveWeights(ctx, ids, input.weights);
    try {
      const expense = await createRecurring(
        ctx.db,
        ctx.hostId,
        {
          title: input.title,
          amount,
          cadence: input.cadence,
          anchorDay: input.anchorDay,
          participants: ids.map((id) => ({ id, weight: weights.get(id) ?? 1 })),
          ...(input.telegramChatId !== undefined ? { telegramChatId: input.telegramChatId } : {}),
        },
        { now: ctx.now },
      );
      return { recurringExpenseId: expense.id, title: expense.title, nextRunAt: expense.nextRunAt };
    } catch (error) {
      if (error instanceof RecurringInputError) throw new ToolError("invalid_input", error.message);
      throw error;
    }
  },
});

export const pauseRecurringTool = writeTool({
  name: "pause_recurring",
  description: "Pause a recurring split so it stops charging. It can be resumed in Settings.",
  kind: "write",
  input: z.object({ recurringExpenseId: z.string().min(1).describe("Id from list_recurring") }),
  async preview(ctx, input): Promise<ActionPreview> {
    const expense = await getRecurring(ctx.db, ctx.hostId, input.recurringExpenseId);
    if (!expense) throw new ToolError("not_found", `no recurring split ${input.recurringExpenseId}; see list_recurring`);
    if (!expense.active) throw new ToolError("invalid_state", `${expense.title} is already paused`);
    return {
      title: `Pause recurring split: ${expense.title}`,
      summary: "Stops future runs. Nothing already charged changes.",
      rows: [
        { label: "Amount per run", value: formatSGD(expense.amount) },
        { label: "Schedule", value: describeCadence(expense.cadence, expense.anchorDay) },
      ],
      openInApp: "/app/settings",
    };
  },
  async run(ctx, input) {
    const expense = await pauseRecurring(ctx.db, ctx.hostId, input.recurringExpenseId);
    return { recurringExpenseId: expense.id, active: expense.active };
  },
});
