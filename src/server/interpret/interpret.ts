import "server-only";

import {
  formatSGD,
  fromDollars,
  MoneyError,
  NO_CHARGES,
  SG_GST_ONLY,
  SG_SERVICE_CHARGE_BPS,
  SG_STANDARD_CHARGES,
  splitReceipt,
  type Cents,
  type ChargePolicy,
  type LineItem,
  type SplitInput,
  type SplitResult,
} from "@/domain";

import { LlmRequestError, type LlmCaller, type LlmMessage, type LlmResponseFormat } from "./client";
import { InterpretError, type InterpretErrorCode } from "./errors";
import { buildMessages, buildRetryMessages } from "./prompt";
import {
  InterpretInputSchema,
  RECEIPT_INTERPRETATION_SCHEMA_NAME,
  ReceiptInterpretationSchema,
  receiptInterpretationJsonSchema,
  type InterpretInput,
  type ReceiptInterpretation,
} from "./schema";

export interface InterpretDeps {
  readonly llm: LlmCaller;
  /** Primary model name. */
  readonly model: string;
  /** Tried once if the primary model fails on the provider side or keeps producing invalid output. */
  readonly fallbackModel?: string;
}

export interface InterpretResult {
  /** What the model read, validated but otherwise verbatim. Contains no computed money. */
  readonly interpretation: ReceiptInterpretation;
  /** The domain input derived from it (cents). */
  readonly splitInput: SplitInput;
  /** `splitReceipt(splitInput)`: totals and per-person shares in cents. */
  readonly split: SplitResult;
  /** Cross-check and fallback notices for the host. Nothing is ever silently adjusted. */
  readonly warnings: readonly string[];
  /** The model that produced `interpretation`. */
  readonly model: string;
  readonly llm: {
    /** Response format the provider accepted. */
    readonly responseFormat: LlmResponseFormat["type"];
    /** Number of completions requested from `model` (1, or 2 after a validation retry). */
    readonly attempts: number;
  };
}

/** Maps the model's yes/no reading of the charge lines to a domain policy. */
export function toChargePolicy(charges: ReceiptInterpretation["charges"]): ChargePolicy {
  if (charges.serviceCharge) {
    return charges.gstInclusive ? { serviceChargeBps: SG_SERVICE_CHARGE_BPS, gstBps: 0 } : SG_STANDARD_CHARGES;
  }
  return charges.gstInclusive ? NO_CHARGES : SG_GST_ONLY;
}

interface ValidationProblem {
  readonly kind: "schema" | "unknown_participant" | "invalid_price";
  readonly message: string;
}

/** Strips markdown fences / surrounding prose that models like to add around JSON. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new SyntaxError("no JSON object found in response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Parses and validates one model response. Returns either the interpretation
 * or a list of human-readable problems to feed back to the model.
 */
export function validateOutput(
  text: string,
  participantIds: ReadonlySet<string>,
): { ok: true; interpretation: ReceiptInterpretation } | { ok: false; problems: ValidationProblem[] } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [{ kind: "schema", message: `response is not valid JSON: ${message}` }] };
  }

  const parsed = ReceiptInterpretationSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        kind: "schema",
        message: `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      })),
    };
  }

  const interpretation = parsed.data;
  const problems: ValidationProblem[] = [];
  const checkId = (id: string, where: string) => {
    if (!participantIds.has(id)) {
      problems.push({
        kind: "unknown_participant",
        message: `${where}: "${id}" is not a participant id (allowed: ${[...participantIds].join(", ")})`,
      });
    }
  };

  interpretation.items.forEach((item, i) => {
    const where = `items[${i}] (${item.label})`;
    item.sharedBy.forEach((id) => checkId(id, `${where}.sharedBy`));
    if (item.weights) Object.keys(item.weights).forEach((id) => checkId(id, `${where}.weights`));
    try {
      if (fromDollars(item.price) < 0) {
        problems.push({ kind: "invalid_price", message: `${where}.price: must not be negative` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push({ kind: "invalid_price", message: `${where}.price: ${message}` });
    }
  });
  interpretation.exclusion?.participants.forEach((id) => checkId(id, "exclusion.participants"));
  if (interpretation.treatedBy) checkId(interpretation.treatedBy, "treatedBy");

  return problems.length > 0 ? { ok: false, problems } : { ok: true, interpretation };
}

/** Maps a validated interpretation to the domain input. Only prices go through `fromDollars`. */
export function toSplitInput(interpretation: ReceiptInterpretation, participantIds: readonly string[]): SplitInput {
  const items: LineItem[] = interpretation.items.map((item) => ({
    label: item.label,
    price: fromDollars(item.price),
    sharedBy: item.sharedBy,
    ...(item.weights ? { weights: item.weights } : {}),
  }));
  const exclusion =
    interpretation.exclusion && interpretation.exclusion.participants.length > 0
      ? { participants: interpretation.exclusion.participants, redistribute: interpretation.exclusion.redistribute }
      : undefined;
  return {
    items,
    charges: toChargePolicy(interpretation.charges),
    participants: participantIds,
    ...(exclusion ? { exclusion } : {}),
    ...(interpretation.treatedBy ? { treatedBy: interpretation.treatedBy } : {}),
  };
}

function crossCheckPrinted(interpretation: ReceiptInterpretation, split: SplitResult): string[] {
  const warnings: string[] = [];
  const check = (label: "subtotal" | "total", printed: string | null | undefined, computed: Cents) => {
    if (printed === undefined || printed === null) return;
    let printedCents: Cents;
    try {
      printedCents = fromDollars(printed);
    } catch {
      warnings.push(`Could not read the printed ${label} "${printed}"; computed ${label} is ${formatSGD(computed)}.`);
      return;
    }
    if (printedCents !== computed) {
      const diff = printedCents - computed;
      warnings.push(
        `Printed ${label} ${formatSGD(printedCents)} differs from computed ${label} ${formatSGD(computed)} ` +
          `(${diff > 0 ? "+" : "-"}${formatSGD(Math.abs(diff))}). Check the items and charge settings; nothing was adjusted.`,
      );
    }
  };
  check("subtotal", interpretation.printed?.subtotal, split.totals.subtotal);
  check("total", interpretation.printed?.total, split.totals.total);
  return warnings;
}

const RESPONSE_FORMAT_ORDER: readonly LlmResponseFormat["type"][] = ["json_schema", "json_object", "text"];

function describeError(error: unknown): string {
  if (error instanceof InterpretError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function problemCode(problems: readonly ValidationProblem[]): InterpretErrorCode {
  if (problems.some((p) => p.kind === "unknown_participant")) return "unknown_participant";
  if (problems.every((p) => p.kind === "invalid_price")) return "invalid_price";
  return "invalid_output";
}

/** A model's output after validation, before any money is computed. */
interface ModelOutcome {
  readonly interpretation: ReceiptInterpretation;
  readonly responseFormat: LlmResponseFormat["type"];
  readonly attempts: number;
}

/**
 * Runs the whole structured-output flow on one model: json_schema, stepping
 * down to json_object then plain text if the provider answers 400; then one
 * validation retry with the problems appended.
 */
async function interpretWithModel(input: InterpretInput, model: string, llm: LlmCaller): Promise<ModelOutcome> {
  const participantIds = input.participants.map((p) => p.id);
  const idSet = new Set(participantIds);
  const schema = receiptInterpretationJsonSchema(participantIds);
  let formatIndex = 0;
  let messages: LlmMessage[] = buildMessages(input);

  const complete = async (): Promise<string> => {
    for (;;) {
      const type = RESPONSE_FORMAT_ORDER[formatIndex];
      const responseFormat: LlmResponseFormat =
        type === "json_schema" ? { type, name: RECEIPT_INTERPRETATION_SCHEMA_NAME, schema } : { type };
      try {
        const completion = await llm.complete({ model, messages, responseFormat });
        return completion.text;
      } catch (error) {
        const canStepDown = error instanceof LlmRequestError && error.isBadRequest && formatIndex < RESPONSE_FORMAT_ORDER.length - 1;
        if (canStepDown) {
          formatIndex += 1;
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new InterpretError("llm_request_failed", message, {
          model,
          status: error instanceof LlmRequestError ? error.status : undefined,
          providerFailure: error instanceof LlmRequestError ? error.isProviderFailure : false,
        });
      }
    }
  };

  const MAX_ATTEMPTS = 2;
  let lastProblems: ValidationProblem[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const text = await complete();
    const validated = validateOutput(text, idSet);
    if (validated.ok) {
      return { interpretation: validated.interpretation, responseFormat: RESPONSE_FORMAT_ORDER[formatIndex], attempts: attempt };
    }
    lastProblems = validated.problems;
    if (attempt < MAX_ATTEMPTS) {
      messages = buildRetryMessages(
        messages,
        text,
        validated.problems.map((p) => p.message),
      );
    }
  }
  throw new InterpretError(
    problemCode(lastProblems),
    `${model} returned an invalid interpretation after ${MAX_ATTEMPTS} attempts`,
    { model, problems: lastProblems.map((p) => p.message) },
  );
}

/** Whether a primary-model failure warrants one attempt on the fallback model. */
function shouldFallBack(error: unknown): boolean {
  if (!(error instanceof InterpretError)) return false;
  switch (error.code) {
    case "invalid_output":
    case "unknown_participant":
    case "invalid_price":
      return true;
    case "llm_request_failed": {
      const details = error.details as { providerFailure?: boolean } | undefined;
      return details?.providerFailure === true;
    }
    default:
      return false;
  }
}

/**
 * Asks the model to interpret the receipt and note, then lets the domain do
 * the money. Returns a proposal only; nothing is persisted. Throws
 * `InterpretError` for every failure mode.
 */
export async function interpretReceipt(input: InterpretInput, deps: InterpretDeps): Promise<InterpretResult> {
  const parsedInput = InterpretInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new InterpretError("invalid_input", "invalid interpret input", parsedInput.error.issues);
  }
  const validInput = parsedInput.data;
  const participantIds = validInput.participants.map((p) => p.id);
  const warnings: string[] = [];

  let model = deps.model;
  let outcome: ModelOutcome;
  try {
    outcome = await interpretWithModel(validInput, model, deps.llm);
  } catch (primaryError) {
    if (deps.fallbackModel === undefined || !shouldFallBack(primaryError)) throw primaryError;
    model = deps.fallbackModel;
    try {
      outcome = await interpretWithModel(validInput, model, deps.llm);
    } catch (fallbackError) {
      if (fallbackError instanceof InterpretError) {
        throw new InterpretError(fallbackError.code, `${fallbackError.message} (after primary model failed: ${describeError(primaryError)})`, {
          ...(typeof fallbackError.details === "object" && fallbackError.details !== null ? fallbackError.details : {}),
          primary: primaryError instanceof InterpretError ? { code: primaryError.code, message: primaryError.message, details: primaryError.details } : describeError(primaryError),
        });
      }
      throw fallbackError;
    }
    warnings.push(`Primary model ${deps.model} failed (${describeError(primaryError)}); this interpretation is from fallback model ${model}.`);
  }

  const { interpretation } = outcome;
  const splitInput = toSplitInput(interpretation, participantIds);
  let split: SplitResult;
  try {
    split = splitReceipt(splitInput);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new InterpretError("split_failed", error.message, { model });
    }
    throw error;
  }

  warnings.push(...crossCheckPrinted(interpretation, split));
  if (interpretation.exclusion && interpretation.exclusion.participants.length === 0) {
    warnings.push("The model returned an empty exclusion list; it was ignored.");
  }
  const onAnItem = new Set(interpretation.items.flatMap((item) => item.sharedBy));
  for (const participant of validInput.participants) {
    if (!onAnItem.has(participant.id) && interpretation.treatedBy !== participant.id) {
      warnings.push(`${participant.name} is not on any item and owes nothing; check the note if that is unexpected.`);
    }
  }

  return {
    interpretation,
    splitInput,
    split,
    warnings,
    model,
    llm: { responseFormat: outcome.responseFormat, attempts: outcome.attempts },
  };
}
