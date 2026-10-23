import "server-only";

import { z } from "zod";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Decoded size of a base64 payload, without decoding it. */
export function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const InterpretFields = z.object({
  /** Receipt photo as a base64 data URL (jpeg/png/webp, max 5 MB). */
  image: z
    .string()
    .refine((url) => IMAGE_DATA_URL.test(url), {
      message: "image must be a base64 data URL of type image/jpeg, image/png or image/webp",
    })
    .refine(
      (url) => base64DecodedBytes(url.slice(url.indexOf(",") + 1)) <= MAX_IMAGE_BYTES,
      { message: "image must be at most 5 MB" },
    )
    .optional(),
  /** Already-transcribed receipt text. */
  receiptText: z.string().trim().min(1).optional(),
  /** The host's free-text note, e.g. "Sarah skipped the drinks". May be empty. */
  note: z.string().max(4000),
  participants: z
    .array(ParticipantSchema)
    .min(1)
    .refine((list) => new Set(list.map((p) => p.id)).size === list.length, {
      message: "participant ids must be unique",
    }),
});

const HAS_RECEIPT = {
  check: (input: { image?: string; receiptText?: string }) => input.image !== undefined || input.receiptText !== undefined,
  message: "provide either image or receiptText",
  path: ["receiptText"],
};

/**
 * Request body of `POST /api/interpret`. `hostId` is accepted for backwards
 * compatibility but IGNORED: the route derives the host from the session.
 */
export const InterpretRequestSchema = InterpretFields.extend({
  hostId: z.string().optional(),
}).refine(HAS_RECEIPT.check, { message: HAS_RECEIPT.message, path: HAS_RECEIPT.path });

/** Input of `interpretReceipt`: the request plus the trusted, session-derived host id. */
export const InterpretInputSchema = InterpretFields.extend({
  /** The participant who fronted the bill (the signed-in host's user id). Never absorbs rounding. */
  hostId: z.string().min(1),
})
  .refine(HAS_RECEIPT.check, { message: HAS_RECEIPT.message, path: HAS_RECEIPT.path })
  .refine((input) => input.participants.some((p) => p.id === input.hostId), {
    message: "hostId must be one of the participant ids",
    path: ["hostId"],
  });

export type InterpretRequest = z.infer<typeof InterpretRequestSchema>;
export type InterpretInput = z.infer<typeof InterpretInputSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;

/** A dollar amount exactly as printed, e.g. "12.30" or "$1,234.50". Parsed by `fromDollars`. */
const PrintedDollars = z.string().trim().min(1);

/**
 * Builds the `ReceiptInterpretation` schema. `participantId` is `z.string()`
 * for validation (unknown ids are reported separately so they can be retried
 * with a precise message) and a `z.enum` of the real ids when generating the
 * JSON schema sent to the provider, which constrains the model up front.
 */
export function receiptInterpretationSchema<T extends z.ZodType<string>>(participantId: T) {
  return z.object({
    items: z
      .array(
        z.object({
          label: z.string().describe("Item name as printed, including quantity if more than one"),
          price: PrintedDollars.describe(
            'Line total in dollars exactly as printed, as a string, e.g. "12.30"; quantity already multiplied in',
          ),
          sharedBy: z
            .array(participantId)
            .min(1)
            .describe("Participant ids sharing this line; equal shares unless weights is set"),
          weights: z
            .record(z.string(), z.number().int().positive())
            .nullable()
            .optional()
            .describe("Optional relative weights (positive integers) keyed by participant id, covering every id in sharedBy"),
        }),
      )
      .min(1),
    charges: z.object({
      serviceCharge: z.boolean().describe("True if a service charge (usually 10%) is added on top of the item prices"),
      gstInclusive: z
        .boolean()
        .describe("True if GST is already included in the printed prices or no GST is charged at all"),
    }),
    exclusion: z
      .object({
        participants: z.array(participantId).describe("Participants who pay nothing, e.g. the birthday person"),
        redistribute: z
          .enum(["proportional", "equal"])
          .describe("How their shares are spread over the others; pick from the note, ask in questions if unclear"),
      })
      .nullable()
      .optional(),
    treatedBy: participantId
      .nullable()
      .optional()
      .describe("Participant id who pays the whole bill, if the note says someone is treating"),
    printed: z
      .object({
        subtotal: PrintedDollars.nullable().optional(),
        total: PrintedDollars.nullable().optional(),
      })
      .nullable()
      .optional()
      .describe("Subtotal / grand total as printed on the receipt, for cross-checking only"),
    assumptions: z.array(z.string()).describe("What you inferred that the note or receipt did not state"),
    questions: z.array(z.string()).describe("Ambiguities the host must resolve before the split is used"),
  });
}

export const ReceiptInterpretationSchema = receiptInterpretationSchema(z.string().min(1));

/** The LLM's structured reading of the receipt and note. Contains no computed money. */
export type ReceiptInterpretation = z.infer<typeof ReceiptInterpretationSchema>;

export const RECEIPT_INTERPRETATION_SCHEMA_NAME = "receipt_interpretation";

/**
 * JSON schema for `response_format: { type: "json_schema" }`, with the real
 * participant ids as enums. Also embedded in the system prompt so JSON-mode
 * and plain-text fallbacks see the same contract.
 */
export function receiptInterpretationJsonSchema(participantIds: readonly string[]): Record<string, unknown> {
  const idSchema = participantIds.length > 0 ? z.enum(participantIds as [string, ...string[]]) : z.string().min(1);
  const jsonSchema = z.toJSONSchema(receiptInterpretationSchema(idSchema), { io: "input" });
  delete jsonSchema.$schema;
  return jsonSchema;
}
