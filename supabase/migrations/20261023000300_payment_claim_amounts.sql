-- Payment claims carry the amount actually paid, which may differ from the
-- requested amount: an overpayment becomes credit (the friend's balance goes
-- negative), an underpayment leaves the request open for further claims.
--
--   friend_button claims: amount null -> the request amount is used at confirm time
--   bank_alert claims:    amount null -> filled from bank_alerts.amount on insert
--   host "record payment": amount set explicitly (or corrected via p_amount)

alter table public.payment_claims
  add column amount bigint check (amount > 0);

-- Partial payments mean several confirmed claims may now settle one request.
drop index public.payment_claims_one_confirmed_per_request;

create or replace function public.payment_claims_default_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount is null and new.bank_alert_id is not null then
    select a.amount into new.amount from public.bank_alerts a where a.id = new.bank_alert_id;
  end if;
  return new;
end;
$$;

create trigger payment_claims_default_amount
  before insert on public.payment_claims
  for each row execute function public.payment_claims_default_amount();

-- ---------------------------------------------------------------------------
-- confirm_payment_claim(claim, amount?): the host accepts a claim. Atomically:
--   * one `payment` ledger event for coalesce(p_amount, claim.amount, request.amount)
--   * claim -> confirmed (amount recorded)
--   * request -> paid only once confirmed payments >= request.amount; then
--     competing pending claims are rejected. Otherwise it stays open.
--   * linked bank alert -> confirmed
-- Returns the ledger event id.
-- ---------------------------------------------------------------------------

drop function public.confirm_payment_claim(uuid);

create function public.confirm_payment_claim(p_claim_id uuid, p_amount bigint default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_claim public.payment_claims%rowtype;
  v_request public.payment_requests%rowtype;
  v_amount bigint;
  v_paid bigint;
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

  v_amount := coalesce(p_amount, v_claim.amount, v_request.amount);
  if v_amount <= 0 then
    raise exception 'confirm_payment_claim: amount must be > 0 (got %)', v_amount
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.ledger_events (host_id, friend_id, type, amount, payment_request_id, bank_alert_id, note, created_by)
  values (
    v_request.host_id, v_request.friend_id, 'payment', v_amount,
    v_request.id, v_claim.bank_alert_id, 'Payment for ' || v_request.reference, 'host'
  )
  returning id into v_event_id;

  update public.payment_claims
    set status = 'confirmed', resolved_at = now(), amount = v_amount
    where id = v_claim.id;

  select coalesce(sum(e.amount), 0) into v_paid
    from public.ledger_events e
    where e.payment_request_id = v_request.id and e.type = 'payment';

  if v_paid >= v_request.amount then
    update public.payment_requests
      set status = 'paid', paid_at = now()
      where id = v_request.id;

    update public.payment_claims
      set status = 'rejected', resolved_at = now()
      where payment_request_id = v_request.id and status = 'pending';
  end if;

  if v_claim.bank_alert_id is not null then
    update public.bank_alerts
      set status = 'confirmed'
      where id = v_claim.bank_alert_id;
  end if;

  return v_event_id;
end;
$$;

revoke execute on function public.payment_claims_default_amount() from public, anon;
revoke execute on function public.confirm_payment_claim(uuid, bigint) from public, anon;
grant execute on function public.confirm_payment_claim(uuid, bigint) to authenticated, service_role;
