-- SQL helpers that mirror src/domain. The domain is the source of truth for
-- the maths; these exist for convenience (dashboards, SQL tests) and for
-- multi-row writes that must be atomic. All functions are SECURITY INVOKER so
-- RLS still applies when called by a host; the service role bypasses RLS.

-- ---------------------------------------------------------------------------
-- friend_balance: same sign convention as balanceOf() in src/domain/balances.ts
--   positive = friend owes host, negative = friend holds credit
-- ---------------------------------------------------------------------------

create or replace function public.ledger_signed_amount(event_type public.ledger_event_type, amount bigint)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case event_type when 'expense_share' then amount else -amount end;
$$;

create or replace function public.friend_balance(p_host_id uuid, p_friend_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(public.ledger_signed_amount(e.type, e.amount)), 0)::bigint
  from public.ledger_events e
  where e.host_id = p_host_id and e.friend_id = p_friend_id;
$$;

create or replace view public.friend_balances
with (security_invoker = true)
as
  select
    f.host_id,
    f.id as friend_id,
    coalesce(sum(public.ledger_signed_amount(e.type, e.amount)), 0)::bigint as balance,
    count(e.id) as event_count
  from public.friends f
  left join public.ledger_events e on e.friend_id = f.id and e.host_id = f.host_id
  group by f.host_id, f.id;

-- ---------------------------------------------------------------------------
-- save_split: receipt + shares + one expense_share event per owing friend,
-- in one transaction (a function body is atomic; any raise rolls back all).
--
--   p_receipt: {
--     hostId, title, occurredAt?, source, serviceChargeBps, gstBps,
--     subtotal, serviceCharge, gst, total, interpretation?, splitInput,
--     telegramChatId?, recurringExpenseId?
--   }
--   p_shares: [{ friendId: uuid | null (host), amount, itemsSubtotal, paysNothing }]
-- Returns the new receipt id.
-- ---------------------------------------------------------------------------

create or replace function public.save_split(p_receipt jsonb, p_shares jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_host_id uuid := (p_receipt ->> 'hostId')::uuid;
  v_receipt_id uuid;
  v_total bigint := (p_receipt ->> 'total')::bigint;
  v_shares_total bigint;
  v_host_shares integer;
begin
  if v_host_id is null then
    raise exception 'save_split: hostId is required' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'save_split: shares must be a non-empty array' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(sum((s ->> 'amount')::bigint), 0), count(*) filter (where s ->> 'friendId' is null)
    into v_shares_total, v_host_shares
  from jsonb_array_elements(p_shares) s;

  if v_shares_total <> v_total then
    raise exception 'save_split: shares sum to % but the receipt total is %', v_shares_total, v_total
      using errcode = 'check_violation';
  end if;
  if v_host_shares > 1 then
    raise exception 'save_split: at most one host share is allowed' using errcode = 'check_violation';
  end if;

  insert into public.receipts (
    host_id, title, occurred_at, source, service_charge_bps, gst_bps,
    subtotal, service_charge, gst, total, interpretation, split_input,
    telegram_chat_id, recurring_expense_id
  ) values (
    v_host_id,
    p_receipt ->> 'title',
    coalesce((p_receipt ->> 'occurredAt')::timestamptz, now()),
    (p_receipt ->> 'source')::public.receipt_source,
    (p_receipt ->> 'serviceChargeBps')::integer,
    (p_receipt ->> 'gstBps')::integer,
    (p_receipt ->> 'subtotal')::bigint,
    (p_receipt ->> 'serviceCharge')::bigint,
    (p_receipt ->> 'gst')::bigint,
    v_total,
    p_receipt -> 'interpretation',
    p_receipt -> 'splitInput',
    (p_receipt ->> 'telegramChatId')::bigint,
    (p_receipt ->> 'recurringExpenseId')::uuid
  )
  returning id into v_receipt_id;

  insert into public.receipt_shares (receipt_id, host_id, friend_id, amount, items_subtotal, pays_nothing)
  select
    v_receipt_id,
    v_host_id,
    (s ->> 'friendId')::uuid,
    (s ->> 'amount')::bigint,
    coalesce((s ->> 'itemsSubtotal')::bigint, 0),
    coalesce((s ->> 'paysNothing')::boolean, false)
  from jsonb_array_elements(p_shares) s;

  insert into public.ledger_events (host_id, friend_id, type, amount, receipt_id, note, created_by)
  select
    v_host_id,
    (s ->> 'friendId')::uuid,
    'expense_share',
    (s ->> 'amount')::bigint,
    v_receipt_id,
    p_receipt ->> 'title',
    coalesce((p_receipt ->> 'createdBy')::public.actor_type, 'host')
  from jsonb_array_elements(p_shares) s
  where s ->> 'friendId' is not null and (s ->> 'amount')::bigint > 0;

  return v_receipt_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_payment_claim: the host accepts a claim -> payment ledger event,
-- request marked paid, linked bank alert confirmed. Atomic. Returns the new
-- ledger event id.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_payment_claim(p_claim_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_claim public.payment_claims%rowtype;
  v_request public.payment_requests%rowtype;
  v_event_id uuid;
begin
  select * into v_claim from public.payment_claims where id = p_claim_id for update;
  if not found then
    raise exception 'confirm_payment_claim: claim % not found', p_claim_id using errcode = 'no_data_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'confirm_payment_claim: claim % is already %', p_claim_id, v_claim.status
      using errcode = 'check_violation';
  end if;

  select * into v_request from public.payment_requests where id = v_claim.payment_request_id for update;
  if v_request.status <> 'open' then
    raise exception 'confirm_payment_claim: payment request % is %', v_request.id, v_request.status
      using errcode = 'check_violation';
  end if;

  insert into public.ledger_events (host_id, friend_id, type, amount, payment_request_id, bank_alert_id, note, created_by)
  values (
    v_request.host_id, v_request.friend_id, 'payment', v_request.amount,
    v_request.id, v_claim.bank_alert_id, 'Payment for ' || v_request.reference, 'host'
  )
  returning id into v_event_id;

  update public.payment_claims
    set status = 'confirmed', resolved_at = now()
    where id = v_claim.id;

  update public.payment_requests
    set status = 'paid', paid_at = now()
    where id = v_request.id;

  update public.payment_claims
    set status = 'rejected', resolved_at = now()
    where payment_request_id = v_request.id and status = 'pending';

  if v_claim.bank_alert_id is not null then
    update public.bank_alerts
      set status = 'confirmed'
      where id = v_claim.bank_alert_id;
  end if;

  return v_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_payment_claim: the host declines a claim; a bank-alert claim puts the
-- alert back to unmatched so it can be re-proposed.
-- ---------------------------------------------------------------------------

create or replace function public.reject_payment_claim(p_claim_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_claim public.payment_claims%rowtype;
begin
  select * into v_claim from public.payment_claims where id = p_claim_id for update;
  if not found then
    raise exception 'reject_payment_claim: claim % not found', p_claim_id using errcode = 'no_data_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'reject_payment_claim: claim % is already %', p_claim_id, v_claim.status
      using errcode = 'check_violation';
  end if;

  update public.payment_claims
    set status = 'rejected', resolved_at = now()
    where id = v_claim.id;

  if v_claim.bank_alert_id is not null then
    update public.bank_alerts
      set status = 'unmatched', proposed_friend_id = null, proposed_payment_request_id = null
      where id = v_claim.bank_alert_id and status = 'proposed';
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default; restrict them to the API
-- roles that may act on behalf of a host.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.ledger_signed_amount(public.ledger_event_type, bigint) to authenticated, service_role;
grant execute on function public.friend_balance(uuid, uuid) to authenticated, service_role;
grant execute on function public.save_split(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.confirm_payment_claim(uuid) to authenticated, service_role;
grant execute on function public.reject_payment_claim(uuid) to authenticated, service_role;
