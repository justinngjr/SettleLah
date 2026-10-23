import "server-only";

import type { Cents } from "@/domain";

/**
 * Provider-agnostic shape of a forwarded email as POSTed to
 * `/api/inbound-email`. The provider adapter (Cloudflare Email Worker,
 * Postmark, Mailgun...) maps its payload to this; see README.
 */
export interface InboundEmail {
  /** Recipient(s) as given by the provider, e.g. `"<token>@in.settlelah.app"` or `"Name <a@b>, c@d"`. */
  readonly to: string;
  /** Envelope/From of the message the provider received (the host's mailbox when forwarded by a filter). */
  readonly from: string;
  readonly subject: string;
  /** Plain-text body. May be empty when only `html` is available. */
  readonly text: string;
  readonly html?: string;
  /** Lower-cased header name -> value(s). Used to find the original bank sender. */
  readonly headers?: Readonly<Record<string, string | readonly string[]>>;
}

export interface ParsedBankAlert {
  readonly amount: Cents;
  /** Payer name as printed by the bank; null if the format has none. */
  readonly payerName: string | null;
  /** Free-text reference / "Other info"; null if absent. */
  readonly reference: string | null;
  readonly receivedAt: Date;
}

export interface BankAlertParser {
  /** Short bank code stored in `bank_alerts.bank`, e.g. `"DBS"`. */
  readonly bank: string;
  /** Cheap check that this email looks like one of this bank's incoming-transfer alerts. */
  canParse(email: InboundEmail): boolean;
  /** Extracts the alert. Throws `ParseError` when a required field is missing. */
  parse(email: InboundEmail): ParsedBankAlert;
}

export class ParseError extends Error {
  constructor(
    readonly bank: string,
    message: string,
  ) {
    super(`${bank}: ${message}`);
    this.name = "ParseError";
  }
}

export type ReconcileErrorCode = "invalid_input" | "not_found" | "invalid_state" | "ambiguous" | "not_configured";

export class ReconcileError extends Error {
  constructor(
    readonly code: ReconcileErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReconcileError";
  }
}
