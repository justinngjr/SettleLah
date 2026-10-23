import { randomUUID } from "node:crypto";

import type { DbClient } from "@/server/db/client";

/**
 * In-memory stand-in for the Supabase client, good enough for the bot's
 * query shapes: from().select/insert/update/upsert with eq/is/gt/order/limit
 * and single/maybeSingle, plus the two payment RPCs. Unique constraints that
 * the code relies on are enforced; everything else is permissive.
 */

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const UNIQUE: Record<string, string[][]> = {
  friends: [["host_id", "telegram_user_id"]],
  telegram_chats: [["host_id", "telegram_chat_id"]],
  telegram_link_tokens: [["token_hash"]],
  reminders: [["payment_request_id"]],
  payment_requests: [["host_id", "reference"]],
  profiles: [["id"], ["telegram_user_id"]],
};

const DEFAULTS: Record<string, () => Row> = {
  profiles: () => ({
    display_name: null,
    telegram_user_id: null,
    telegram_username: null,
    paynow_display_name: null,
    paynow_proxy_type: null,
    paynow_proxy_value: null,
  }),
  friends: () => ({
    telegram_user_id: null,
    telegram_username: null,
    private_chat_started: false,
    known_bank_names: [],
    archived: false,
  }),
  telegram_chats: () => ({ title: null, linked_at: new Date().toISOString() }),
  receipts: () => ({ telegram_chat_id: null, occurred_at: new Date().toISOString() }),
  receipt_shares: () => ({ pays_nothing: false, items_subtotal: 0 }),
  payment_requests: () => ({ status: "open", note: null, paid_at: null, cancelled_at: null, receipt_id: null }),
  payment_claims: () => ({ status: "pending", amount: null, bank_alert_id: null, resolved_at: null, claimed_at: new Date().toISOString() }),
  reminders: () => ({ snoozed_until: null, last_sent_at: null, escalated_at: null, channel: "private", stage: 0 }),
  telegram_link_tokens: () => ({ used_at: null, single_use: true, receipt_id: null }),
  telegram_binding_requests: () => ({
    status: "pending",
    resolved_at: null,
    host_message_id: null,
    source_chat_id: null,
    via_private_chat: false,
    telegram_username: null,
    telegram_first_name: null,
  }),
  ledger_events: () => ({ note: null, receipt_id: null, created_by: "system" }),
};

export class FakeDb {
  readonly tables = new Map<string, Row[]>();
  /** Clock used for created_at defaults; tests advance it. */
  now: () => Date = () => new Date();

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  insert(name: string, values: Row): Row {
    const row: Row = {
      id: randomUUID(),
      created_at: this.now().toISOString(),
      updated_at: this.now().toISOString(),
      ...(DEFAULTS[name]?.() ?? {}),
      ...values,
    };
    this.assertUnique(name, row, null);
    this.table(name).push(row);
    return row;
  }

  private assertUnique(name: string, row: Row, except: Row | null): void {
    for (const cols of UNIQUE[name] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = this.table(name).find((r) => r !== except && cols.every((c) => r[c] === row[c]));
      if (clash) {
        const err = new Error(`duplicate key value violates unique constraint ${name}_${cols.join("_")}_key`);
        (err as Error & { code: string }).code = "23505";
        throw err;
      }
    }
  }

  rpc(name: string, args: Row): unknown {
    if (name === "confirm_payment_claim") {
      const claim = this.table("payment_claims").find((c) => c.id === args.p_claim_id);
      if (!claim || claim.status !== "pending") throw new Error("claim not pending");
      const request = this.table("payment_requests").find((r) => r.id === claim.payment_request_id);
      if (!request) throw new Error("request missing");
      const amount = (args.p_amount as number | undefined) ?? (claim.amount as number | null) ?? (request.amount as number);
      const now = this.now().toISOString();
      Object.assign(claim, { status: "confirmed", amount, resolved_at: now });
      Object.assign(request, { status: "paid", paid_at: now });
      const event = this.insert("ledger_events", {
        host_id: request.host_id,
        friend_id: request.friend_id,
        type: "payment",
        amount,
        payment_request_id: request.id,
      });
      return event.id;
    }
    if (name === "reject_payment_claim") {
      const claim = this.table("payment_claims").find((c) => c.id === args.p_claim_id);
      if (!claim || claim.status !== "pending") throw new Error("claim not pending");
      Object.assign(claim, { status: "rejected", resolved_at: this.now().toISOString() });
      return null;
    }
    throw new Error(`unknown rpc ${name}`);
  }

  client(): DbClient {
    return {
      from: (table: string) => new Builder(this, table),
      rpc: (name: string, args: Row) => {
        const run = async () => {
          try {
            return { data: this.rpc(name, args), error: null };
          } catch (error) {
            return { data: null, error: { message: (error as Error).message, code: "P0001", details: "" } };
          }
        };
        return { then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej) };
      },
    } as unknown as DbClient;
  }
}

type Op = { kind: "select" } | { kind: "insert"; values: Row | Row[] } | { kind: "update"; values: Row } | { kind: "upsert"; values: Row; onConflict: string[] };

class Builder {
  private op: Op = { kind: "select" };
  private readonly filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    if (this.op.kind === "select") return this;
    this.returning = true;
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = { kind: "insert", values };
    return this;
  }
  update(values: Row): this {
    this.op = { kind: "update", values };
    return this;
  }
  upsert(values: Row, options?: { onConflict?: string }): this {
    this.op = { kind: "upsert", values, onConflict: (options?.onConflict ?? "id").split(",") };
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  gt(column: string, value: string): this {
    this.filters.push((row) => String(row[column]) > value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.mode = "single";
    return this;
  }
  maybeSingle(): this {
    this.mode = "maybe";
    return this;
  }

  private matching(): Row[] {
    let rows = this.db.table(this.table).filter((row) => this.filters.every((f) => f(row)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private execute(): Row[] {
    const op = this.op;
    switch (op.kind) {
      case "select":
        return this.matching();
      case "insert":
        return (Array.isArray(op.values) ? op.values : [op.values]).map((v) => this.db.insert(this.table, v));
      case "update": {
        const rows = this.matching();
        for (const row of rows) Object.assign(row, op.values, { updated_at: this.db.now().toISOString() });
        return rows;
      }
      case "upsert": {
        const existing = this.db.table(this.table).find((row) => op.onConflict.every((c) => row[c] === op.values[c]));
        if (existing) {
          Object.assign(existing, op.values);
          return [existing];
        }
        return [this.db.insert(this.table, op.values)];
      }
    }
  }

  then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): Promise<unknown> {
    return new Promise((res) => {
      let rows: Row[];
      try {
        rows = this.execute();
      } catch (error) {
        const e = error as Error & { code?: string };
        res({ data: null, error: { message: e.message, code: e.code ?? "XX000", details: "" }, count: null, status: 400, statusText: "Bad Request" });
        return;
      }
      const copy = rows.map((r) => ({ ...r }));
      let data: unknown = copy;
      let error: unknown = null;
      if (this.mode === "single") {
        if (copy.length !== 1) error = { message: `expected one row, got ${copy.length}`, code: "PGRST116", details: "" };
        data = copy[0] ?? null;
      } else if (this.mode === "maybe") {
        if (copy.length > 1) error = { message: "multiple rows", code: "PGRST116", details: "" };
        data = copy[0] ?? null;
      } else if (this.op.kind !== "select" && !this.returning) {
        data = null;
      }
      res({ data: error ? null : data, error, count: null, status: 200, statusText: "OK" });
    }).then(resolve, reject);
  }
}
