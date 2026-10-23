begin;
\ir lib/helpers.psql
select plan(21);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_friend(:'a_id', 'Bob') as id \gset bob_
select tests.create_friend(:'a_id', 'Cara') as id \gset cara_

select tests.authenticate_as(:'a_id');

-- Reference uniqueness and format -----------------------------------------------
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('22222222-2222-2222-2222-222222222222', :'a_id', :'bob_id', 2500, 'SL7HK2MN');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference) values (%L, %L, 100, ''SL7HK2MN'')', :'a_id', :'cara_id'),
  '23505', null, 'duplicate reference is rejected');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference) values (%L, %L, 100, ''SL0OI1AB'')', :'a_id', :'cara_id'),
  '23514', null, 'ambiguous characters 0/O/I/1 are rejected');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference) values (%L, %L, 100, ''sl7hk2mn'')', :'a_id', :'cara_id'),
  '23514', null, 'lowercase reference is rejected');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference) values (%L, %L, 0, ''SLABCDEF'')', :'a_id', :'cara_id'),
  '23514', null, 'zero-amount request is rejected');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference, status) values (%L, %L, 1, ''SLABCDEF'', ''paid'')', :'a_id', :'cara_id'),
  '23514', null, 'paid status requires paid_at');

-- Claims: confirm creates exactly one payment event ----------------------------
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'bob_id', 'expense_share', 2500);
insert into public.payment_claims (id, payment_request_id, host_id, source)
  values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', :'a_id', 'friend_button');
insert into public.payment_claims (id, payment_request_id, host_id, source)
  values ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', :'a_id', 'friend_button');

select throws_ok(
  format('insert into public.payment_claims (payment_request_id, host_id, source) values (%L, %L, ''bank_alert'')', '22222222-2222-2222-2222-222222222222', :'a_id'),
  '23514', null, 'a bank_alert claim must reference a bank alert');

select is(public.friend_balance(:'a_id', :'bob_id'), 2500::bigint, 'Bob owes 2500 before confirmation');
select public.confirm_payment_claim('66666666-6666-6666-6666-666666666666') as id \gset event_
select is(count(*), 1::bigint, 'confirm inserted one payment event') from public.ledger_events
  where id = :'event_id' and type = 'payment' and amount = 2500 and friend_id = :'bob_id'
    and payment_request_id = '22222222-2222-2222-2222-222222222222';
select is(status, 'confirmed'::public.payment_claim_status, 'claim confirmed') from public.payment_claims where id = '66666666-6666-6666-6666-666666666666';
select is(status, 'rejected'::public.payment_claim_status, 'competing pending claim auto-rejected') from public.payment_claims where id = '77777777-7777-7777-7777-777777777777';
select is(status, 'paid'::public.payment_request_status, 'request marked paid') from public.payment_requests where id = '22222222-2222-2222-2222-222222222222';
select isnt(paid_at, null, 'paid_at set') from public.payment_requests where id = '22222222-2222-2222-2222-222222222222';
select is(public.friend_balance(:'a_id', :'bob_id'), 0::bigint, 'Bob is settled');
select throws_ok('select public.confirm_payment_claim(''66666666-6666-6666-6666-666666666666'')', '23514', null,
  'confirming twice is rejected');
select throws_ok('select public.reject_payment_claim(''77777777-7777-7777-7777-777777777777'')', '23514', null,
  'rejecting a resolved claim is rejected');
select is(count(*), 1::bigint, 'still exactly one payment event for the request') from public.ledger_events
  where payment_request_id = '22222222-2222-2222-2222-222222222222';

-- Reject path ----------------------------------------------------------------------
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('88888888-8888-8888-8888-888888888888', :'a_id', :'cara_id', 900, 'SLQRSTUV');
insert into public.bank_alerts (id, host_id, bank, amount, raw_hash, status, proposed_friend_id, proposed_payment_request_id)
  values ('33333333-3333-3333-3333-333333333333', :'a_id', 'OCBC', 900, repeat('b', 64), 'proposed', :'cara_id', '88888888-8888-8888-8888-888888888888');
insert into public.payment_claims (id, payment_request_id, host_id, source, bank_alert_id)
  values ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', :'a_id', 'bank_alert', '33333333-3333-3333-3333-333333333333');
select public.reject_payment_claim('99999999-9999-9999-9999-999999999999');
select is(status, 'rejected'::public.payment_claim_status, 'bank-alert claim rejected') from public.payment_claims where id = '99999999-9999-9999-9999-999999999999';
select is(status, 'unmatched'::public.bank_alert_status, 'bank alert returned to unmatched') from public.bank_alerts where id = '33333333-3333-3333-3333-333333333333';
select is(count(*), 0::bigint, 'rejecting creates no ledger event') from public.ledger_events where payment_request_id = '88888888-8888-8888-8888-888888888888';

-- friend_balance sign convention = src/domain/balances.ts -------------------------
-- expense_share +, payment/credit/friend_fronted -
insert into public.ledger_events (host_id, friend_id, type, amount) values
  (:'a_id', :'cara_id', 'expense_share', 1000),
  (:'a_id', :'cara_id', 'payment', 400),
  (:'a_id', :'cara_id', 'credit', 100),
  (:'a_id', :'cara_id', 'friend_fronted', 50),
  (:'a_id', :'cara_id', 'expense_share', 7);
select is(public.friend_balance(:'a_id', :'cara_id'), 457::bigint, 'balance = 1000 - 400 - 100 - 50 + 7');
select results_eq(
  format('select friend_id, balance from public.friend_balances where host_id = %L order by balance desc', :'a_id'),
  format('values (%L::uuid, 457::bigint), (%L::uuid, 0::bigint)', :'cara_id', :'bob_id'),
  'friend_balances view lists every friend with the same numbers');

select * from finish();
rollback;
