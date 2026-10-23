import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

/** Postgres SQLSTATE for `unique_violation`. */
export const UNIQUE_VIOLATION = "23505";

export class DbError extends Error {
  readonly code: string | undefined;
  readonly details: string | undefined;

  constructor(context: string, error: Pick<PostgrestError, "message" | "code" | "details"> | null) {
    super(error ? `${context}: ${error.message}` : `${context}: no data returned`);
    this.name = "DbError";
    this.code = error?.code;
    this.details = error?.details;
  }
}

interface Result<T> {
  readonly data: T | null;
  readonly error: PostgrestError | null;
}

/** Throws a `DbError` on a PostgREST error; returns `data` otherwise (which may be `null`). */
export function unwrap<T>(result: Result<T>, context: string): T | null {
  if (result.error) throw new DbError(context, result.error);
  return result.data;
}

/** Like `unwrap` but `null` data is also an error (e.g. `.single()` that found nothing). */
export function unwrapRequired<T>(result: Result<T>, context: string): NonNullable<T> {
  const data = unwrap(result, context);
  if (data === null || data === undefined) throw new DbError(context, null);
  return data;
}
