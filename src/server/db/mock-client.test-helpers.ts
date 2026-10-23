import type { DbClient } from "./client";

export interface MockResponse {
  readonly data?: unknown;
  readonly error?: { message: string; code?: string; details?: string } | null;
}

export interface RecordedCall {
  readonly table?: string;
  readonly rpc?: string;
  readonly rpcArgs?: unknown;
  /** Query-builder method calls in order, e.g. `["eq", ["host_id", "h1"]]`. */
  readonly chain: Array<[string, unknown[]]>;
}

/**
 * A minimal stand-in for the Supabase client: every builder method records
 * itself and returns the builder; awaiting the builder yields the next queued
 * response. Lets repository tests assert the exact query shape and mapping
 * without a database.
 */
export function createMockDb(responses: MockResponse[] = []) {
  const queue = [...responses];
  const calls: RecordedCall[] = [];

  function builder(call: RecordedCall): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "then") {
            const next = queue.shift() ?? { data: null, error: null };
            const result = { data: next.data ?? null, error: next.error ?? null, count: null, status: 200, statusText: "OK" };
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            call.chain.push([prop, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const db = {
    from(table: string) {
      const call: RecordedCall = { table, chain: [] };
      calls.push(call);
      return builder(call);
    },
    rpc(name: string, args: unknown) {
      const call: RecordedCall = { rpc: name, rpcArgs: args, chain: [] };
      calls.push(call);
      return builder(call);
    },
  };

  return { db: db as unknown as DbClient, calls, pending: () => queue.length };
}

export function chainOf(call: RecordedCall): string[] {
  return call.chain.map(([method]) => method);
}

export function argsOf(call: RecordedCall, method: string): unknown[][] {
  return call.chain.filter(([m]) => m === method).map(([, args]) => args);
}
