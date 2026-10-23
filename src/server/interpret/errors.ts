import "server-only";

export type InterpretErrorCode =
  /** The request to this layer was malformed (bad participants, no receipt, ...). */
  | "invalid_input"
  /** LLM env vars are not configured. */
  | "llm_unavailable"
  /** The provider returned an error or could not be reached. */
  | "llm_request_failed"
  /** The model's output was not valid `ReceiptInterpretation` JSON, even after one retry. */
  | "invalid_output"
  /** The model referenced a participant id that is not in the participant list. */
  | "unknown_participant"
  /** An item price as read by the model could not be parsed as dollars. */
  | "invalid_price"
  /** The mapped `SplitInput` was rejected by the domain (`splitReceipt`). */
  | "split_failed";

/**
 * The single error type thrown by `interpretReceipt`. `details` is JSON-safe
 * and intended for the API error body.
 */
export class InterpretError extends Error {
  readonly code: InterpretErrorCode;
  readonly details?: unknown;

  constructor(code: InterpretErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "InterpretError";
    this.code = code;
    this.details = details;
  }
}
