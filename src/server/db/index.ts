import "server-only";

export { createDbClient, createServiceClient, type DbClient } from "./client";
export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate } from "./database.types";
export { DbError, UNIQUE_VIOLATION } from "./errors";
export {
  archiveFriend,
  createFriend,
  getFriend,
  listFriends,
  toFriend,
  unarchiveFriend,
  updateFriend,
  type Friend,
  type FriendPatch,
  type NewFriend,
} from "./friends";
export {
  appendLedgerEvent,
  friendBalanceSql,
  listBalances,
  loadLedger,
  toLedgerEvent,
  type FriendBalance,
  type NewLedgerEvent,
} from "./ledger";
export {
  cancelPaymentRequest,
  confirmPaymentClaim,
  createPaymentClaim,
  createPaymentRequest,
  generateReference,
  getPaymentRequestByReference,
  isValidReference,
  listPaymentRequests,
  listPendingClaims,
  REFERENCE_ALPHABET,
  REFERENCE_PATTERN,
  rejectPaymentClaim,
  toPaymentClaim,
  toPaymentRequest,
  type NewPaymentClaim,
  type NewPaymentRequest,
  type PaymentClaim,
  type PaymentRequest,
} from "./payments";
export { buildSaveSplitArgs, saveSplit, type FriendMap, type ReceiptInput } from "./splits";
