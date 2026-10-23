-- Bank-email reconciliation (Session H).
--
--   * profiles.auto_confirm_bank_alerts: per-host opt-in. Off by default: a
--     parsed alert is only ever a proposal until the host taps confirm. When
--     on, the webhook may confirm by itself the narrow case of an exact
--     PayNow reference match to an open request for the same amount from a
--     payer name the host already confirmed for that friend.
--   * bank_alerts gains the parsed-but-not-raw context the host needs to judge
--     a proposal (who the bank says paid, which bank sender, the subject) and
--     the matcher's verdict. The raw email is never stored, only raw_hash.

alter table public.profiles
  add column auto_confirm_bank_alerts boolean not null default false;

alter table public.bank_alerts
  -- Original sender address the alert was verified against (e.g. ibanking.alert@dbs.com).
  add column sender text,
  add column subject text,
  -- Why the alert is `ignored` / `unmatched`: sender_not_allowed, parse_failed,
  -- no_candidates, ambiguous, host_ignored.
  add column reason text,
  add column match_confidence text check (match_confidence in ('strong', 'weak')),
  -- reference | known_name_and_amount | amount_only
  add column match_reason text,
  -- A proposal always points at a request (and therefore a friend).
  add constraint bank_alerts_proposed_has_request check (
    status <> 'proposed' or (proposed_payment_request_id is not null and proposed_friend_id is not null)
  );

create index bank_alerts_proposed_request_idx
  on public.bank_alerts (proposed_payment_request_id) where proposed_payment_request_id is not null;
