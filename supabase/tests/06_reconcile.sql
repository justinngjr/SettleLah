begin;
\ir lib/helpers.psql
select plan(14);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_
select tests.create_friend(:'a_id', 'Bob') as id \gset bob_

-- Auto-confirm is opt-in and host-private ---------------------------------------
select tests.authenticate_as(:'a_id');
select is(auto_confirm_bank_alerts, false, 'auto-confirm defaults to off') from public.profiles where id = :'a_id';
update public.profiles set auto_confirm_bank_alerts = true where id = :'a_id';
select is(auto_confirm_bank_alerts, true, 'host can switch auto-confirm on') from public.profiles where id = :'a_id';

select tests.authenticate_as(:'b_id');
select is(count(*), 0::bigint, 'B cannot see A''s setting') from public.profiles where id = :'a_id';
update public.profiles set auto_confirm_bank_alerts = false where id = :'a_id';
select tests.clear_auth();
select is(auto_confirm_bank_alerts, true, 'B''s update of A''s setting is a no-op (RLS)') from public.profiles where id = :'a_id';

-- A proposal must point at a request -------------------------------------------------
select tests.authenticate_as(:'a_id');
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000001', :'a_id', :'bob_id', 2500, 'SLBBBBBB');
select throws_ok(
  format('insert into public.bank_alerts (host_id, bank, amount, raw_hash, status) values (%L, %L, 2500, %L, %L)', :'a_id', 'DBS', repeat('1', 64), 'proposed'),
  '23514', null, 'proposed alert without a request is rejected');
select throws_ok(
  format('insert into public.bank_alerts (host_id, bank, amount, raw_hash, match_confidence) values (%L, %L, 2500, %L, %L)', :'a_id', 'DBS', repeat('2', 64), 'maybe'),
  '23514', null, 'match_confidence is strong|weak');
insert into public.bank_alerts (id, host_id, bank, amount, payer_name, reference, raw_hash, status, proposed_friend_id, proposed_payment_request_id,
                                sender, subject, match_confidence, match_reason)
  values ('b0000000-0000-0000-0000-000000000001', :'a_id', 'DBS', 2600, 'ROBERT TAN', 'SLBBBBBB', repeat('3', 64), 'proposed', :'bob_id', 'a0000000-0000-0000-0000-000000000001',
          'ibanking.alert@dbs.com', 'Incoming PayNow transfer', 'strong', 'reference');
select lives_ok('select 1', 'proposed alert with request, sender, subject and verdict inserts');

-- Idempotency: same raw_hash twice for one host is rejected, another host may reuse it
select throws_ok(
  format('insert into public.bank_alerts (host_id, bank, amount, raw_hash) values (%L, %L, 1, %L)', :'a_id', 'DBS', repeat('3', 64)),
  '23505', null, 'duplicate raw_hash for the same host is rejected');
select tests.clear_auth();
insert into public.bank_alerts (host_id, bank, amount, raw_hash) values (:'b_id', 'DBS', 1, repeat('3', 64));
select lives_ok('select 1', 'another host may store the same raw_hash');

-- Confirming the proposal writes exactly one payment event with the alert amount
select tests.authenticate_as(:'a_id');
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'bob_id', 'expense_share', 2500);
insert into public.payment_claims (id, payment_request_id, host_id, source, bank_alert_id)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', :'a_id', 'bank_alert', 'b0000000-0000-0000-0000-000000000001');
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000001') as id \gset ev_
select is(count(*), 1::bigint, 'exactly one payment event for the alert') from public.ledger_events
  where bank_alert_id = 'b0000000-0000-0000-0000-000000000001' and type = 'payment';
select is(amount, 2600::bigint, 'payment event carries the alert amount, not the request amount') from public.ledger_events where id = :'ev_id';
select is(status, 'confirmed'::public.bank_alert_status, 'alert confirmed') from public.bank_alerts where id = 'b0000000-0000-0000-0000-000000000001';
select is(public.friend_balance(:'a_id', :'bob_id'), -100::bigint, 'overpayment is credit');

-- Host isolation on the new columns ------------------------------------------------
select tests.authenticate_as(:'b_id');
select is(count(*), 0::bigint, 'B sees none of A''s alerts (incl. sender/subject)') from public.bank_alerts where sender is not null;

select * from finish();
rollback;
