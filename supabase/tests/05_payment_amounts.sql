begin;
\ir lib/helpers.psql
select plan(34);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_friend(:'a_id', 'Bob') as id \gset bob_
select tests.create_friend(:'a_id', 'Cara') as id \gset cara_
select tests.create_friend(:'a_id', 'Dan') as id \gset dan_
select tests.create_friend(:'a_id', 'Eve') as id \gset eve_
select tests.create_friend(:'a_id', 'Fay') as id \gset fay_

select tests.authenticate_as(:'a_id');


-- Exact payment closes the request --------------------------------------------------
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'bob_id', 'expense_share', 2500);
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000001', :'a_id', :'bob_id', 2500, 'SLBBBBBB');
insert into public.payment_claims (id, payment_request_id, host_id, source)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', :'a_id', 'friend_button');
select is(amount, null, 'friend_button claim amount stays null until confirmed') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000001';
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000001') as id \gset bob_event_
select is(amount, 2500::bigint, 'exact: payment event uses the request amount') from public.ledger_events where id = :'bob_event_id';
select is(amount, 2500::bigint, 'exact: confirmed claim records the amount paid') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000001';
select is(status, 'paid'::public.payment_request_status, 'exact: request paid') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000001';
select is(public.friend_balance(:'a_id', :'bob_id'), 0::bigint, 'exact: Bob settled');

-- Overpayment closes the request and becomes credit --------------------------------
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'cara_id', 'expense_share', 1000);
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000002', :'a_id', :'cara_id', 1000, 'SLCCCCCC');
insert into public.payment_claims (id, payment_request_id, host_id, source, amount)
  values ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', :'a_id', 'friend_button', 1200);
insert into public.payment_claims (id, payment_request_id, host_id, source)
  values ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', :'a_id', 'friend_button');
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000002') as id \gset cara_event_
select is(amount, 1200::bigint, 'over: payment event uses the claimed amount') from public.ledger_events where id = :'cara_event_id';
select is(status, 'paid'::public.payment_request_status, 'over: request paid') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000002';
select is(status, 'rejected'::public.payment_claim_status, 'over: competing pending claim rejected once paid') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000003';
-- domain: balanceOf = -200, creditOf = max(0, -balance) = 200
select is(public.friend_balance(:'a_id', :'cara_id'), -200::bigint, 'over: balance is negative by the excess');
select is(greatest(0, -public.friend_balance(:'a_id', :'cara_id')), 200::bigint, 'over: credit = 200 (domain creditOf)');

-- Underpayment leaves the request open; a second partial closes it -----------------
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'dan_id', 'expense_share', 3000);
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000003', :'a_id', :'dan_id', 3000, 'SLDDDDDD');
insert into public.payment_claims (id, payment_request_id, host_id, source, amount) values
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', :'a_id', 'friend_button', 1000),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', :'a_id', 'friend_button', 2000),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003', :'a_id', 'friend_button', 5);
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000004') as id \gset dan_event1_
select is(amount, 1000::bigint, 'under: payment event uses the partial amount') from public.ledger_events where id = :'dan_event1_id';
select is(status, 'open'::public.payment_request_status, 'under: request stays open') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000003';
select is(paid_at, null, 'under: paid_at not set') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000003';
select is(status, 'pending'::public.payment_claim_status, 'under: other pending claims are NOT auto-rejected') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000005';
select is(public.friend_balance(:'a_id', :'dan_id'), 2000::bigint, 'under: balance = remainder');
insert into public.payment_claims (id, payment_request_id, host_id, source, amount)
  values ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000003', :'a_id', 'friend_button', 2000);
select lives_ok('select 1', 'under: further claims on an open request are accepted');
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000005') as id \gset dan_event2_
select is(status, 'paid'::public.payment_request_status, 'two partials: request paid') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000003';
select is(count(*), 2::bigint, 'two partials: two payment events linked to the request') from public.ledger_events
  where payment_request_id = 'a0000000-0000-0000-0000-000000000003' and type = 'payment';
select is(public.friend_balance(:'a_id', :'dan_id'), 0::bigint, 'two partials: Dan settled');
select is(status, 'rejected'::public.payment_claim_status, 'two partials: leftover pending claim rejected once paid') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000006';
select is(status, 'rejected'::public.payment_claim_status, 'two partials: late pending claim rejected once paid') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000007';
select throws_ok('select public.confirm_payment_claim(''c0000000-0000-0000-0000-000000000007'')', '23514', null,
  'confirming a rejected claim is refused');

-- Bank-alert claim uses the alert amount ----------------------------------------------
insert into public.ledger_events (host_id, friend_id, type, amount) values (:'a_id', :'eve_id', 'expense_share', 900);
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000004', :'a_id', :'eve_id', 900, 'SLEEEEEE');
insert into public.bank_alerts (id, host_id, bank, amount, raw_hash, status, proposed_friend_id, proposed_payment_request_id)
  values ('b0000000-0000-0000-0000-000000000001', :'a_id', 'DBS', 950, repeat('e', 64), 'proposed', :'eve_id', 'a0000000-0000-0000-0000-000000000004');
insert into public.payment_claims (id, payment_request_id, host_id, source, bank_alert_id)
  values ('c0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000004', :'a_id', 'bank_alert', 'b0000000-0000-0000-0000-000000000001');
select is(amount, 950::bigint, 'bank alert: claim amount filled from bank_alerts.amount') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000008';
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000008') as id \gset eve_event_
select is(amount, 950::bigint, 'bank alert: payment event uses the alert amount') from public.ledger_events where id = :'eve_event_id';
select is(bank_alert_id, 'b0000000-0000-0000-0000-000000000001'::uuid, 'bank alert: payment event links the alert') from public.ledger_events where id = :'eve_event_id';
select is(status, 'paid'::public.payment_request_status, 'bank alert: request paid') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000004';
select is(status, 'confirmed'::public.bank_alert_status, 'bank alert: alert confirmed') from public.bank_alerts where id = 'b0000000-0000-0000-0000-000000000001';
select is(public.friend_balance(:'a_id', :'eve_id'), -50::bigint, 'bank alert: excess becomes credit');

-- Host corrects the amount while confirming (p_amount) -------------------------------
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('a0000000-0000-0000-0000-000000000005', :'a_id', :'fay_id', 500, 'SLFFFFFF');
insert into public.payment_claims (id, payment_request_id, host_id, source, amount) values
  ('c0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000005', :'a_id', 'friend_button', 500),
  ('c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', :'a_id', 'friend_button', 500);
select throws_ok('select public.confirm_payment_claim(''c0000000-0000-0000-0000-000000000009'', 0)', '22023', null,
  'p_amount must be > 0');
select is(status, 'pending'::public.payment_claim_status, 'failed confirm leaves the claim pending') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000009';
select public.confirm_payment_claim('c0000000-0000-0000-0000-000000000009', 300) as id \gset fay_event_
select is(amount, 300::bigint, 'p_amount overrides the claimed amount') from public.ledger_events where id = :'fay_event_id';
select is(amount, 300::bigint, 'p_amount is recorded on the claim') from public.payment_claims where id = 'c0000000-0000-0000-0000-000000000009';
select is(status, 'open'::public.payment_request_status, 'p_amount below request leaves it open') from public.payment_requests where id = 'a0000000-0000-0000-0000-000000000005';
select is(status, 'pending'::public.payment_claim_status, 'other claim still pending while open') from public.payment_claims where id = 'c0000000-0000-0000-0000-00000000000a';

-- Constraint -------------------------------------------------------------------------
