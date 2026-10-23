/**
 * SettleLah domain layer: the code that handles the money.
 *
 * Pure TypeScript only: no imports from `next`, `react`, `@supabase/*` or
 * `src/app`. See ./README.md for the rule and rationale. All amounts are
 * integer cents; there is no floating-point arithmetic on money.
 */

export {
  assertCents,
  assertNonNegativeCents,
  formatSGD,
  fromDollars,
  isCents,
  MoneyError,
  type Cents,
} from "./money";

export {
  applyRateHalfUp,
  assertBasisPoints,
  assertChargePolicy,
  BPS_PER_WHOLE,
  computeCharges,
  NO_CHARGES,
  SG_GST_BPS,
  SG_GST_ONLY,
  SG_SERVICE_CHARGE_BPS,
  SG_STANDARD_CHARGES,
  type BasisPoints,
  type ChargePolicy,
  type ReceiptTotals,
} from "./charges";

export {
  allocateRemainder,
  type RemainderCandidate,
  type RemainderPolicy,
} from "./rounding";

export {
  splitReceipt,
  SplitError,
  type Exclusion,
  type ExclusionRedistribution,
  type LineItem,
  type ParticipantId,
  type ParticipantShare,
  type SplitInput,
  type SplitResult,
} from "./split";

export {
  allBalances,
  appendEvent,
  assertLedgerEvent,
  balanceOf,
  creditOf,
  outstandingRequest,
  signedAmount,
  type FriendId,
  type Ledger,
  type LedgerEvent,
  type LedgerEventType,
} from "./balances";
