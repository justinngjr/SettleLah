import type { Tables } from "@/server/db";

export const HOST_ID = "00000000-0000-4000-8000-00000000aaaa";
export const OTHER_HOST_ID = "00000000-0000-4000-8000-00000000bbbb";
export const FRIEND_ID = "00000000-0000-4000-8000-0000000000f1";
export const FRIEND2_ID = "00000000-0000-4000-8000-0000000000f2";
export const REQUEST_ID = "00000000-0000-4000-8000-0000000000e1";
export const REQUEST2_ID = "00000000-0000-4000-8000-0000000000e2";
export const ALERT_ID = "00000000-0000-4000-8000-0000000000a1";
export const CLAIM_ID = "00000000-0000-4000-8000-0000000000c1";
export const LEDGER_EVENT_ID = "00000000-0000-4000-8000-0000000000d1";

export function routeRow(overrides: Partial<Tables<"inbound_email_routes">> = {}): Tables<"inbound_email_routes"> {
  return { id: "r1", host_id: HOST_ID, token: "a3f9c2d1e4b5f6a7b8c9d0e1f2a3b4c5", created_at: "2026-01-01T00:00:00Z", revoked_at: null, ...overrides };
}

export function requestRow(overrides: Partial<Tables<"payment_requests">> = {}): Tables<"payment_requests"> {
  return {
    id: REQUEST_ID,
    host_id: HOST_ID,
    friend_id: FRIEND_ID,
    amount: 2500,
    reference: "SLBBBBBB",
    status: "open",
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    paid_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

export function friendRow(overrides: Partial<Tables<"friends">> = {}): Tables<"friends"> {
  return {
    id: FRIEND_ID,
    host_id: HOST_ID,
    display_name: "Rob",
    telegram_user_id: null,
    telegram_username: null,
    known_bank_names: [],
    private_chat_started: false,
    archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function alertRow(overrides: Partial<Tables<"bank_alerts">> = {}): Tables<"bank_alerts"> {
  return {
    id: ALERT_ID,
    host_id: HOST_ID,
    bank: "DBS",
    received_at: "2025-01-12T06:05:00Z",
    amount: 2500,
    payer_name: "ROBERT TAN",
    reference: "SLBBBBBB",
    raw_hash: "deadbeef",
    sender: "ibanking.alert@dbs.com",
    subject: "Incoming PayNow Transfer",
    status: "proposed",
    reason: null,
    proposed_friend_id: FRIEND_ID,
    proposed_payment_request_id: REQUEST_ID,
    match_confidence: "strong",
    match_reason: "reference",
    created_at: "2025-01-12T06:05:01Z",
    ...overrides,
  };
}

export function claimRow(overrides: Partial<Tables<"payment_claims">> = {}): Tables<"payment_claims"> {
  return {
    id: CLAIM_ID,
    host_id: HOST_ID,
    payment_request_id: REQUEST_ID,
    claimed_at: "2025-01-12T06:05:02Z",
    source: "bank_alert",
    bank_alert_id: ALERT_ID,
    amount: 2500,
    status: "pending",
    resolved_at: null,
    ...overrides,
  };
}
