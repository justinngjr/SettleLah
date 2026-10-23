-- SettleLah core schema.
--
-- Conventions
--   * Every table is owned by a host (an auth.users row) through `host_id`.
--     Child tables (receipt_shares, payment_claims, reminders) carry a
--     denormalised `host_id` as well, tied to the parent with a composite
--     foreign key so it can never disagree with the parent's host.
--   * Money is `bigint` cents. Magnitudes carry `check (... >= 0)`; the sign
--     of a ledger event comes from its `type` (see src/domain/balances.ts).
--   * Rates are integer basis points (10 000 bp = 100%).
--   * The ledger is append-only: see 20261023000100_rls.sql.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (mirror the string unions in src/domain and src/server)
-- ---------------------------------------------------------------------------

create type public.paynow_proxy_type as enum ('mobile', 'uen');
create type public.receipt_source as enum ('manual', 'llm');
create type public.ledger_event_type as enum ('expense_share', 'payment', 'credit', 'friend_fronted');
create type public.actor_type as enum ('host', 'system');
create type public.payment_request_status as enum ('open', 'paid', 'cancelled');
create type public.payment_claim_source as enum ('friend_button', 'bank_alert');
create type public.payment_claim_status as enum ('pending', 'confirmed', 'rejected');
create type public.reminder_channel as enum ('group', 'private');
create type public.recurring_cadence as enum ('monthly', 'weekly');
create type public.bank_alert_status as enum ('unmatched', 'proposed', 'confirmed', 'ignored');

-- ---------------------------------------------------------------------------
-- profiles: one per host, created automatically on sign-up
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  paynow_proxy_type public.paynow_proxy_type,
  paynow_proxy_value text,
  paynow_display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_paynow_proxy_complete check (
    (paynow_proxy_type is null) = (paynow_proxy_value is null)
  )
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- friends: people the host collects from. Never hard-deleted, only archived.
-- ---------------------------------------------------------------------------

create table public.friends (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) > 0),
  telegram_user_id bigint,
  telegram_username text,
  private_chat_started boolean not null default false,
  known_bank_names text[] not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, host_id),
  unique (host_id, telegram_user_id)
);

create index friends_host_id_idx on public.friends (host_id) where not archived;

create trigger friends_set_updated_at
  before update on public.friends
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- telegram_chats: group chats the host's bot has been linked to
-- ---------------------------------------------------------------------------

create table public.telegram_chats (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  telegram_chat_id bigint not null,
  title text,
  linked_at timestamptz not null default now(),
  unique (host_id, telegram_chat_id)
);

-- ---------------------------------------------------------------------------
-- recurring_expenses: templates a future job turns into receipts
-- ---------------------------------------------------------------------------

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  amount bigint not null check (amount >= 0),
  cadence public.recurring_cadence not null,
  -- monthly: day of month 1..31 (clamped to month length by the runner); weekly: 0 (Sun) .. 6 (Sat)
  anchor_day integer not null check (anchor_day between 0 and 31),
  -- [{ "friendId": uuid, "weight": positive int }, ...]
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  service_charge_bps integer not null default 0 check (service_charge_bps >= 0),
  gst_bps integer not null default 0 check (gst_bps >= 0),
  next_run_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, host_id)
);

create index recurring_expenses_due_idx on public.recurring_expenses (next_run_at) where active;

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- receipts + receipt_shares: a split bill and who owes what
-- ---------------------------------------------------------------------------

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  occurred_at timestamptz not null default now(),
  source public.receipt_source not null,
  service_charge_bps integer not null check (service_charge_bps >= 0),
  gst_bps integer not null check (gst_bps >= 0),
  subtotal bigint not null check (subtotal >= 0),
  service_charge bigint not null check (service_charge >= 0),
  gst bigint not null check (gst >= 0),
  total bigint not null check (total >= 0),
  -- The LLM's structured reading (ReceiptInterpretation); null for manual receipts.
  interpretation jsonb,
  -- The domain SplitInput the shares were computed from (cents).
  split_input jsonb not null,
  telegram_chat_id bigint,
  recurring_expense_id uuid,
  created_at timestamptz not null default now(),
  unique (id, host_id),
  constraint receipts_total_adds_up check (total = subtotal + service_charge + gst),
  constraint receipts_telegram_chat_fkey
    foreign key (host_id, telegram_chat_id)
    references public.telegram_chats (host_id, telegram_chat_id)
    on delete set null (telegram_chat_id),
  constraint receipts_recurring_expense_fkey
    foreign key (recurring_expense_id, host_id)
    references public.recurring_expenses (id, host_id)
    on delete set null (recurring_expense_id)
);

create index receipts_host_occurred_idx on public.receipts (host_id, occurred_at desc);
create index receipts_recurring_expense_idx on public.receipts (recurring_expense_id) where recurring_expense_id is not null;

create table public.receipt_shares (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  -- null = the host's own share (stored for display, never owed)
  friend_id uuid,
  amount bigint not null check (amount >= 0),
  items_subtotal bigint not null default 0 check (items_subtotal >= 0),
  pays_nothing boolean not null default false,
  constraint receipt_shares_receipt_fkey
    foreign key (receipt_id, host_id) references public.receipts (id, host_id) on delete cascade,
  constraint receipt_shares_friend_fkey
    foreign key (friend_id, host_id) references public.friends (id, host_id),
  unique nulls not distinct (receipt_id, friend_id)
);

create index receipt_shares_friend_idx on public.receipt_shares (host_id, friend_id);

-- ---------------------------------------------------------------------------
-- payment_requests: "please pay me X, reference SLxxxxxx"
-- ---------------------------------------------------------------------------

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null,
  amount bigint not null check (amount > 0),
  -- SL + 6 chars from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (no 0/1/I/O). Generated by the app, retried on collision.
  reference text not null unique check (reference ~ '^SL[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  status public.payment_request_status not null default 'open',
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  unique (id, host_id),
  constraint payment_requests_friend_fkey
    foreign key (friend_id, host_id) references public.friends (id, host_id),
  constraint payment_requests_paid_at_matches_status check ((status = 'paid') = (paid_at is not null)),
  constraint payment_requests_cancelled_at_matches_status check ((status = 'cancelled') = (cancelled_at is not null))
);

create index payment_requests_host_status_idx on public.payment_requests (host_id, status);
create index payment_requests_friend_idx on public.payment_requests (host_id, friend_id);

-- ---------------------------------------------------------------------------
-- bank_alerts: incoming-transfer emails forwarded by the host (reconciliation)
-- ---------------------------------------------------------------------------

create table public.bank_alerts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  bank text not null,
  received_at timestamptz not null default now(),
  amount bigint not null check (amount >= 0),
  payer_name text,
  reference text,
  -- sha256 (hex) of the raw email, for idempotent ingestion
  raw_hash text not null,
  status public.bank_alert_status not null default 'unmatched',
  proposed_friend_id uuid,
  proposed_payment_request_id uuid,
  created_at timestamptz not null default now(),
  unique (id, host_id),
  unique (host_id, raw_hash),
  constraint bank_alerts_proposed_friend_fkey
    foreign key (proposed_friend_id, host_id) references public.friends (id, host_id)
    on delete set null (proposed_friend_id),
  constraint bank_alerts_proposed_payment_request_fkey
    foreign key (proposed_payment_request_id, host_id) references public.payment_requests (id, host_id)
    on delete set null (proposed_payment_request_id)
);

create index bank_alerts_host_status_idx on public.bank_alerts (host_id, status, received_at desc);
create index bank_alerts_reference_idx on public.bank_alerts (host_id, reference) where reference is not null;

-- ---------------------------------------------------------------------------
-- payment_claims: "this request was paid" proposals, confirmed by the host
-- ---------------------------------------------------------------------------

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  source public.payment_claim_source not null,
  bank_alert_id uuid,
  status public.payment_claim_status not null default 'pending',
  resolved_at timestamptz,
  constraint payment_claims_request_fkey
    foreign key (payment_request_id, host_id) references public.payment_requests (id, host_id) on delete cascade,
  constraint payment_claims_bank_alert_fkey
    foreign key (bank_alert_id, host_id) references public.bank_alerts (id, host_id),
  constraint payment_claims_bank_alert_source check (
    (source = 'bank_alert') = (bank_alert_id is not null)
  ),
  constraint payment_claims_resolved_at_matches_status check (
    (status = 'pending') = (resolved_at is null)
  )
);

create index payment_claims_request_idx on public.payment_claims (payment_request_id);
create index payment_claims_pending_idx on public.payment_claims (host_id) where status = 'pending';
create unique index payment_claims_one_confirmed_per_request
  on public.payment_claims (payment_request_id) where status = 'confirmed';

-- ---------------------------------------------------------------------------
-- reminders: escalation state for an open payment request (one row per request)
-- ---------------------------------------------------------------------------

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  stage integer not null default 0 check (stage >= 0),
  next_at timestamptz not null,
  snoozed_until timestamptz,
  last_sent_at timestamptz,
  channel public.reminder_channel not null default 'private',
  constraint reminders_request_fkey
    foreign key (payment_request_id, host_id) references public.payment_requests (id, host_id) on delete cascade
);

create index reminders_due_idx on public.reminders (next_at);

-- ---------------------------------------------------------------------------
-- ledger_events: the append-only source of truth for balances
-- ---------------------------------------------------------------------------

create table public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null,
  type public.ledger_event_type not null,
  -- Always a magnitude; the sign comes from `type` (expense_share +, everything else -).
  amount bigint not null check (amount >= 0),
  receipt_id uuid,
  payment_request_id uuid,
  bank_alert_id uuid,
  note text,
  created_at timestamptz not null default now(),
  created_by public.actor_type not null default 'host',
  constraint ledger_events_friend_fkey
    foreign key (friend_id, host_id) references public.friends (id, host_id),
  constraint ledger_events_receipt_fkey
    foreign key (receipt_id, host_id) references public.receipts (id, host_id),
  constraint ledger_events_payment_request_fkey
    foreign key (payment_request_id, host_id) references public.payment_requests (id, host_id),
  constraint ledger_events_bank_alert_fkey
    foreign key (bank_alert_id, host_id) references public.bank_alerts (id, host_id)
);

create index ledger_events_host_friend_idx on public.ledger_events (host_id, friend_id, created_at);
create index ledger_events_receipt_idx on public.ledger_events (receipt_id) where receipt_id is not null;
create index ledger_events_payment_request_idx on public.ledger_events (payment_request_id) where payment_request_id is not null;

-- Append-only: rows can never be changed, and can only disappear together
-- with their host's auth.users row (the cascade from account deletion).
create or replace function public.ledger_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.host_id) then
    return old;
  end if;
  raise exception 'ledger_events is append-only (% not allowed)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger ledger_events_immutable
  before update or delete on public.ledger_events
  for each row execute function public.ledger_events_immutable();

-- ---------------------------------------------------------------------------
-- inbound_email_routes: secret token in the host's bank-alert forwarding address
-- ---------------------------------------------------------------------------

create table public.inbound_email_routes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique check (length(token) >= 16),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index inbound_email_routes_host_idx on public.inbound_email_routes (host_id);
