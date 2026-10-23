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
  hostNeverAbsorbs,
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

export {
  assertDate,
  daysInMonth,
  fromSgt,
  isValidDate,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  SGT_UTC_OFFSET_MINUTES,
  sgtDateString,
  startOfSgtDay,
  toSgt,
  type SgtParts,
} from "./sgt";

export {
  assertReference,
  buildPayNowPayload,
  crc16CcittFalse,
  encodeTlv,
  formatAmount,
  MAX_PAYEE_NAME_LENGTH,
  MAX_PAYNOW_CENTS,
  MAX_REFERENCE_LENGTH,
  normaliseSgMobile,
  normaliseUen,
  parseTlv,
  PAYNOW_ACCOUNT_FIELD,
  PAYNOW_ADDITIONAL_FIELD,
  PAYNOW_FIELD,
  PAYNOW_SCHEME,
  PayNowError,
  sanitisePayeeName,
  verifyPayNowCrc,
  type PayNowPayloadInput,
  type PayNowProxyType,
  type TlvField,
} from "./paynow";

export {
  afterSent,
  afterSnooze,
  assertReminderState,
  createReminderState,
  dueAt,
  FIRST_NUDGE_DELAY_MS,
  MAX_STAGE,
  nextReminder,
  nextSendWindow,
  QUIET_HOURS,
  reminderMessage,
  ReminderError,
  scheduledAt,
  SNOOZE_MS,
  WEEKLY_INTERVAL_MS,
  type ReminderChannel,
  type ReminderDecision,
  type ReminderMessageInput,
  type ReminderState,
  type ReminderStatus,
} from "./reminders";

export {
  applyRecurringCharge,
  creditCovers,
  nextRunAt,
  RECURRING_RUN_HOUR_SGT,
  recurringCharge,
  RecurringError,
  topUpNeeded,
  type NextRunInput,
  type RecurringCadence,
  type RecurringChargeInput,
  type RecurringParticipant,
} from "./recurring";
