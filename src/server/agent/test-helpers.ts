import { randomUUID } from "node:crypto";

import { LlmRequestError, type LlmCaller, type LlmCompletion, type LlmRequest, type LlmToolCall } from "@/server/interpret/client";
import { createDeps, type TelegramDeps } from "@/server/telegram";
import { FakeTelegram } from "@/server/telegram/fake-api.test-helpers";
import { FakeDb, type Row } from "@/server/telegram/fake-db.test-helpers";
import { CONFIG, GROUP_CHAT } from "@/server/telegram/setup.test-helpers";

import type { AgentDeps } from "./loop";
import type { ToolContext } from "./tools";

/** FakeDb plus what the agent needs: `seq` on messages, the `save_split` RPC and the agent tables' defaults. */
export class AgentFakeDb extends FakeDb {
  private seq = 0;

  override insert(name: string, values: Row): Row {
    const extra: Row =
      name === "agent_messages"
        ? { seq: ++this.seq, content: "", tool_calls: null, tool_call_id: null, tool_result: null }
        : name === "agent_actions"
          ? {
              status: "pending",
              expires_at: new Date(this.now().getTime() + 30 * 60 * 1000).toISOString(),
              result: null,
              error: null,
              executed_at: null,
              resolved_at: null,
            }
          : name === "agent_conversations"
            ? { title: null }
            : {};
    return super.insert(name, { ...extra, ...values });
  }

  override rpc(name: string, args: Row): unknown {
    if (name !== "save_split") return super.rpc(name, args);
    const receipt = args.p_receipt as Record<string, unknown>;
    const shares = args.p_shares as Array<Record<string, unknown>>;
    const total = shares.reduce((sum, s) => sum + (s.amount as number), 0);
    if (total !== receipt.total) throw new Error(`save_split: shares sum to ${total} but the receipt total is ${String(receipt.total)}`);
    const row = this.insert("receipts", {
      host_id: receipt.hostId,
      title: receipt.title,
      occurred_at: receipt.occurredAt ?? this.now().toISOString(),
      source: receipt.source,
      service_charge_bps: receipt.serviceChargeBps,
      gst_bps: receipt.gstBps,
      subtotal: receipt.subtotal,
      service_charge: receipt.serviceCharge,
      gst: receipt.gst,
      total: receipt.total,
      interpretation: receipt.interpretation ?? null,
      split_input: receipt.splitInput,
      telegram_chat_id: receipt.telegramChatId ?? null,
      recurring_expense_id: receipt.recurringExpenseId ?? null,
    });
    for (const share of shares) {
      this.insert("receipt_shares", {
        receipt_id: row.id,
        host_id: receipt.hostId,
        friend_id: share.friendId ?? null,
        amount: share.amount,
        items_subtotal: share.itemsSubtotal ?? 0,
        pays_nothing: share.paysNothing ?? false,
      });
      if (share.friendId && (share.amount as number) > 0) {
        this.insert("ledger_events", {
          host_id: receipt.hostId,
          friend_id: share.friendId,
          type: "expense_share",
          amount: share.amount,
          receipt_id: row.id,
          note: receipt.title,
          created_by: receipt.createdBy ?? "host",
        });
      }
    }
    return row.id;
  }
}

export const T0 = new Date("2026-03-02T04:00:00Z");

export interface AgentWorld {
  readonly db: AgentFakeDb;
  readonly tg: FakeTelegram;
  readonly telegram: TelegramDeps;
  readonly clock: { now: Date };
  readonly hostId: string;
  readonly sarah: Row;
  readonly ben: Row;
  readonly dan: Row;
  /** Ben's open request for $20. */
  readonly benRequest: Row;
  /** Dan's open request for $30. */
  readonly danRequest: Row;
  ctx(overrides?: Partial<ToolContext>): ToolContext;
  conversation(): string;
}

/**
 * A host with three friends. Ben owes $20 and Dan owes $30 (expense shares
 * with open requests); Sarah is settled. Dan has started the bot privately;
 * the host has one linked Telegram group.
 */
export function agentWorld(options: { readonly interpret?: AgentDeps; readonly now?: Date } = {}): AgentWorld {
  const db = new AgentFakeDb();
  const tg = new FakeTelegram();
  const clock = { now: options.now ?? T0 };
  db.now = () => clock.now;
  const hostId = randomUUID();
  db.insert("profiles", {
    id: hostId,
    display_name: "Jun Wei",
    paynow_display_name: "JUN WEI TAN",
    paynow_proxy_type: "mobile",
    paynow_proxy_value: "91234567",
    telegram_user_id: 999,
    telegram_username: "junwei",
  });
  db.insert("telegram_chats", { host_id: hostId, telegram_chat_id: GROUP_CHAT, title: "Dinner gang" });
  const sarah = db.insert("friends", { host_id: hostId, display_name: "Sarah" });
  const ben = db.insert("friends", { host_id: hostId, display_name: "Ben" });
  const dan = db.insert("friends", { host_id: hostId, display_name: "Dan", telegram_user_id: 444, telegram_username: "dan", private_chat_started: true });
  const owe = (friend: Row, amount: number, reference: string) => {
    db.insert("ledger_events", { host_id: hostId, friend_id: friend.id, type: "expense_share", amount, created_by: "host" });
    return db.insert("payment_requests", { host_id: hostId, friend_id: friend.id, amount, reference });
  };
  const benRequest = owe(ben, 2000, "SLBEN222");
  const danRequest = owe(dan, 3000, "SLDAN333");
  const telegram = createDeps(CONFIG, { db: db.client(), transformer: tg.transformer, now: () => clock.now });

  return {
    db,
    tg,
    telegram,
    clock,
    hostId,
    sarah,
    ben,
    dan,
    benRequest,
    danRequest,
    ctx: (overrides = {}) => ({
      db: db.client(),
      hostId,
      now: clock.now,
      telegram: () => telegram,
      ...(options.interpret ? { interpret: options.interpret } : {}),
      ...overrides,
    }),
    conversation: () => db.insert("agent_conversations", { host_id: hostId }).id as string,
  };
}

// Scripted model ---------------------------------------------------------------

export type AgentStep = (request: LlmRequest) => LlmCompletion | Promise<LlmCompletion>;

/** A model that answers from a script; `requests` records what it was asked. */
export function scriptedAgentLlm(steps: readonly AgentStep[], baseURL = "https://fake.llm.test"): { llm: LlmCaller; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const llm: LlmCaller = {
    baseURL,
    async complete(request) {
      requests.push(request);
      const step = steps[requests.length - 1];
      if (step === undefined) throw new Error(`unexpected LLM call #${requests.length}`);
      return step(request);
    },
  };
  return { llm, requests };
}

let callCounter = 0;

export function toolCall(name: string, args: unknown): LlmToolCall {
  callCounter += 1;
  return { id: `call_${callCounter}`, name, arguments: JSON.stringify(args) };
}

/** Native-mode reply: text plus tool calls. */
export const native =
  (text: string, ...calls: LlmToolCall[]): AgentStep =>
  () => ({ text, toolCalls: calls });

/** JSON-protocol reply, as a provider without `tools` would return it. */
export const jsonProtocol =
  (say: string, calls: readonly { name: string; args: unknown }[] = []): AgentStep =>
  () => ({ text: JSON.stringify({ say, tool_calls: calls }) });

/** Fails the request with an HTTP status, e.g. 400 (tools unsupported) or 503 (provider down). */
export const httpError =
  (status: number, message = `provider returned ${status}`): AgentStep =>
  () => {
    throw new LlmRequestError(message, status);
  };

/** Answers 400 to any request carrying `tools`, otherwise delegates. */
export const rejectsTools =
  (step: AgentStep): AgentStep =>
  (request) => {
    if (request.tools && request.tools.length > 0) throw new LlmRequestError("tools not supported", 400);
    return step(request);
  };

export function deps(llm: LlmCaller, overrides: Partial<AgentDeps> = {}): AgentDeps {
  return { llm, model: "primary-model", ...overrides };
}
