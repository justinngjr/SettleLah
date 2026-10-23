import type { ChargePolicy, ReceiptTotals } from "./charges";
import { computeCharges } from "./charges";
import type { Cents } from "./money";
import { assertNonNegativeCents, MoneyError } from "./money";
import type { Rational } from "./rational";
import {
  bigintToSafeNumber,
  RATIONAL_ZERO,
  ratio,
  rationalAdd,
  rationalDiv,
  rationalFloor,
  rationalFraction,
  rationalFromInt,
  rationalIsZero,
  rationalMul,
} from "./rational";
import type { RemainderCandidate, RemainderPolicy } from "./rounding";
import { allocateRemainder } from "./rounding";

export type ParticipantId = string;

/** A receipt line as printed, *before* service charge and GST. */
export interface LineItem {
  readonly label?: string;
  /** Line total in cents (already multiplied by quantity), >= 0. */
  readonly price: Cents;
  /** Who shares this line. Equal shares unless `weights` is given. */
  readonly sharedBy: readonly ParticipantId[];
  /**
   * Optional relative weights, positive integers keyed by participant id, e.g.
   * `{ alice: 2, bob: 1 }` for a 2:1 split. Every id in `sharedBy` must have a
   * weight when this is provided.
   */
  readonly weights?: Readonly<Record<ParticipantId, number>>;
}

export interface SplitInput {
  readonly items: readonly LineItem[];
  readonly charges: ChargePolicy;
  /**
   * Participant order, used for output order and for deterministic rounding
   * tie-breaks. Defaults to order of first appearance in `items` (then
   * `excluded`, then `treatedBy`). When given, every id referenced elsewhere
   * must be listed here.
   */
  readonly participants?: readonly ParticipantId[];
  /**
   * Participants who pay nothing (e.g. the birthday person). Their item shares
   * are redistributed to the remaining payers in proportion to what those
   * payers ordered.
   */
  readonly excluded?: readonly ParticipantId[];
  /** One participant pays the whole receipt; everyone else owes 0. */
  readonly treatedBy?: ParticipantId;
  /** Defaults to the largest-remainder `allocateRemainder` in rounding.ts. */
  readonly remainderPolicy?: RemainderPolicy;
}

export interface ParticipantShare {
  readonly participantId: ParticipantId;
  /**
   * The exact amount this participant owes, in cents. All `amount`s sum to
   * `totals.total` exactly.
   */
  readonly amount: Cents;
  /**
   * This participant's pre-charge item subtotal, rounded half-up to the cent
   * for display only. Not used in the allocation and the column may not sum
   * to `totals.subtotal` exactly.
   */
  readonly itemsSubtotal: Cents;
  /** True for excluded participants and for non-treating participants when someone treats. */
  readonly paysNothing: boolean;
}

export interface SplitResult {
  readonly totals: ReceiptTotals;
  readonly shares: readonly ParticipantShare[];
}

export class SplitError extends MoneyError {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

function assertParticipantId(value: unknown, label: string): ParticipantId {
  if (typeof value !== "string" || value.length === 0) {
    throw new SplitError(`${label} must be a non-empty participant id`);
  }
  return value;
}

function assertWeight(value: unknown, participantId: ParticipantId): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new SplitError(`weight for ${participantId} must be a positive integer`);
  }
  return value;
}

function validateItem(item: LineItem, index: number): void {
  const label = `items[${index}]${item.label ? ` (${item.label})` : ""}`;
  assertNonNegativeCents(item.price, `${label}.price`);
  if (!Array.isArray(item.sharedBy) || item.sharedBy.length === 0) {
    throw new SplitError(`${label}.sharedBy must list at least one participant`);
  }
  const seen = new Set<ParticipantId>();
  for (const id of item.sharedBy) {
    assertParticipantId(id, `${label}.sharedBy`);
    if (seen.has(id)) {
      throw new SplitError(`${label}.sharedBy lists ${id} more than once`);
    }
    seen.add(id);
  }
  if (item.weights !== undefined) {
    for (const id of item.sharedBy) {
      if (!Object.hasOwn(item.weights, id)) {
        throw new SplitError(`${label}.weights is missing ${id}`);
      }
      assertWeight(item.weights[id], id);
    }
  }
}

function resolveParticipants(input: SplitInput): ParticipantId[] {
  const referenced: ParticipantId[] = [];
  const add = (id: ParticipantId) => {
    if (!referenced.includes(id)) referenced.push(id);
  };
  for (const item of input.items) item.sharedBy.forEach(add);
  (input.excluded ?? []).forEach((id) => add(assertParticipantId(id, "excluded")));
  if (input.treatedBy !== undefined) add(assertParticipantId(input.treatedBy, "treatedBy"));

  if (input.participants === undefined) return referenced;

  const declared = new Set<ParticipantId>();
  for (const id of input.participants) {
    assertParticipantId(id, "participants");
    if (declared.has(id)) throw new SplitError(`participants lists ${id} more than once`);
    declared.add(id);
  }
  for (const id of referenced) {
    if (!declared.has(id)) throw new SplitError(`${id} is referenced but not in participants`);
  }
  return [...input.participants];
}

/** Each participant's exact pre-charge subtotal from their item shares. */
function itemSubtotals(items: readonly LineItem[], participants: readonly ParticipantId[]) {
  const subtotals = new Map<ParticipantId, Rational>(participants.map((id) => [id, RATIONAL_ZERO]));
  for (const item of items) {
    const weightOf = (id: ParticipantId) => (item.weights === undefined ? 1 : item.weights[id]);
    const totalWeight = item.sharedBy.reduce((sum, id) => sum + weightOf(id), 0);
    for (const id of item.sharedBy) {
      const share = ratio(BigInt(item.price) * BigInt(weightOf(id)), totalWeight);
      subtotals.set(id, rationalAdd(subtotals.get(id) ?? RATIONAL_ZERO, share));
    }
  }
  return subtotals;
}

function roundHalfUpToCents(value: Rational): Cents {
  const half = ratio(1, 2);
  return bigintToSafeNumber(rationalFloor(rationalAdd(value, half)));
}

/**
 * Allocates `total` across `weights` in exact proportion, flooring each exact
 * share and handing the leftover cents to `policy`. Zero-weight entries always
 * receive 0. Returns amounts in the same order as `weights`.
 */
function allocateProportionally(
  total: Cents,
  participants: readonly ParticipantId[],
  weights: readonly Rational[],
  policy: RemainderPolicy,
): Cents[] {
  const weightSum = weights.reduce(rationalAdd, RATIONAL_ZERO);
  if (rationalIsZero(weightSum)) {
    if (total !== 0) throw new SplitError("nobody is left to pay the total");
    return participants.map(() => 0);
  }

  const candidates: RemainderCandidate[] = [];
  const floors: Cents[] = [];
  let allocated = 0;
  for (let i = 0; i < participants.length; i++) {
    const exact = rationalDiv(rationalMul(rationalFromInt(total), weights[i]), weightSum);
    const floor = bigintToSafeNumber(rationalFloor(exact));
    floors.push(floor);
    allocated += floor;
    candidates.push({
      participantId: participants[i],
      floorCents: floor,
      fraction: rationalFraction(exact),
    });
  }

  const leftover = total - allocated;
  const extras = policy(leftover, candidates);
  if (extras.length !== candidates.length) {
    throw new SplitError("remainder policy returned the wrong number of entries");
  }
  const amounts = floors.map((floor, i) => {
    assertNonNegativeCents(extras[i], `remainder for ${participants[i]}`);
    if (rationalIsZero(weights[i]) && extras[i] !== 0) {
      throw new SplitError(`remainder policy gave cents to zero-weight ${participants[i]}`);
    }
    return floor + extras[i];
  });
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    throw new SplitError(`shares sum to ${sum} but the total is ${total}`);
  }
  return amounts;
}

/**
 * Splits a receipt. Each participant's pre-charge subtotal is computed
 * exactly from their item shares, then the receipt's final total (subtotal +
 * service charge + GST, each rounded as printed) is allocated in proportion
 * to those subtotals, so the shares always sum to the printed total exactly.
 */
export function splitReceipt(input: SplitInput): SplitResult {
  input.items.forEach(validateItem);
  const participants = resolveParticipants(input);
  const excluded = new Set(input.excluded ?? []);
  if (input.treatedBy !== undefined && excluded.has(input.treatedBy)) {
    throw new SplitError(`${input.treatedBy} cannot both treat and be excluded`);
  }

  const subtotal = input.items.reduce((sum, item) => sum + item.price, 0);
  assertNonNegativeCents(subtotal, "subtotal");
  const totals = computeCharges(subtotal, input.charges);
  const subtotals = itemSubtotals(input.items, participants);

  const paysNothing = (id: ParticipantId) =>
    excluded.has(id) || (input.treatedBy !== undefined && id !== input.treatedBy);

  let weights: Rational[];
  if (input.treatedBy !== undefined) {
    weights = participants.map((id) => (id === input.treatedBy ? rationalFromInt(1) : RATIONAL_ZERO));
  } else {
    weights = participants.map((id) => (excluded.has(id) ? RATIONAL_ZERO : (subtotals.get(id) ?? RATIONAL_ZERO)));
    const payers = participants.filter((id) => !excluded.has(id));
    if (payers.length > 0 && weights.every(rationalIsZero)) {
      // Only excluded participants ordered anything: payers split the total equally.
      weights = participants.map((id) => (excluded.has(id) ? RATIONAL_ZERO : rationalFromInt(1)));
    }
  }

  const amounts = allocateProportionally(
    totals.total,
    participants,
    weights,
    input.remainderPolicy ?? allocateRemainder,
  );

  return {
    totals,
    shares: participants.map((participantId, i) => ({
      participantId,
      amount: amounts[i],
      itemsSubtotal: roundHalfUpToCents(subtotals.get(participantId) ?? RATIONAL_ZERO),
      paysNothing: paysNothing(participantId),
    })),
  };
}
