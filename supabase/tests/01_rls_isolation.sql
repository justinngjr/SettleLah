begin;
\ir lib/helpers.psql
select plan(51);

-- Two hosts; host A owns one row in every table, host B must see none of them.
select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_

select tests.clear_auth();
select tests.create_friend(:'a_id', 'Alice friend') as id \gset friend_
insert into public.telegram_chats (host_id, telegram_chat_id, title) values (:'a_id', 1001, 'Dinner gang');
insert into public.recurring_expenses (host_id, title, amount, cadence, anchor_day) values (:'a_id', 'Netflix', 1790, 'monthly', 1);
insert into public.receipts (id, host_id, title, source, service_charge_bps, gst_bps, subtotal, service_charge, gst, total, split_input)
  values ('11111111-1111-1111-1111-111111111111', :'a_id', 'Supper', 'manual', 0, 0, 1000, 0, 0, 1000, '{}'::jsonb);
insert into public.receipt_shares (receipt_id, host_id, friend_id, amount)
  values ('11111111-1111-1111-1111-111111111111', :'a_id', :'friend_id', 1000);
insert into public.payment_requests (id, host_id, friend_id, amount, reference)
  values ('22222222-2222-2222-2222-222222222222', :'a_id', :'friend_id', 1000, 'SLABCDEF');
insert into public.bank_alerts (id, host_id, bank, amount, raw_hash)
  values ('33333333-3333-3333-3333-333333333333', :'a_id', 'DBS', 1000, repeat('a', 64));
insert into public.payment_claims (id, payment_request_id, host_id, source, bank_alert_id)
  values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', :'a_id', 'bank_alert', '33333333-3333-3333-3333-333333333333');
insert into public.reminders (payment_request_id, host_id, next_at) values ('22222222-2222-2222-2222-222222222222', :'a_id', now());
insert into public.ledger_events (host_id, friend_id, type, amount, receipt_id)
  values (:'a_id', :'friend_id', 'expense_share', 1000, '11111111-1111-1111-1111-111111111111');
insert into public.inbound_email_routes (host_id, token) values (:'a_id', 'tok_aaaaaaaaaaaaaaaaaaaaaaaa');

-- Host A sees exactly their row in every table -------------------------------
select tests.authenticate_as(:'a_id');
select is(count(*), 1::bigint, 'A sees own profile') from public.profiles;
select is(count(*), 1::bigint, 'A sees own friends') from public.friends;
select is(count(*), 1::bigint, 'A sees own telegram_chats') from public.telegram_chats;
select is(count(*), 1::bigint, 'A sees own recurring_expenses') from public.recurring_expenses;
select is(count(*), 1::bigint, 'A sees own receipts') from public.receipts;
select is(count(*), 1::bigint, 'A sees own receipt_shares') from public.receipt_shares;
select is(count(*), 1::bigint, 'A sees own payment_requests') from public.payment_requests;
select is(count(*), 1::bigint, 'A sees own bank_alerts') from public.bank_alerts;
select is(count(*), 1::bigint, 'A sees own payment_claims') from public.payment_claims;
select is(count(*), 1::bigint, 'A sees own reminders') from public.reminders;
select is(count(*), 1::bigint, 'A sees own ledger_events') from public.ledger_events;
select is(count(*), 1::bigint, 'A sees own inbound_email_routes') from public.inbound_email_routes;
select is(count(*), 1::bigint, 'A sees own friend_balances') from public.friend_balances;
select is(public.friend_balance(:'a_id', :'friend_id'), 1000::bigint, 'A can compute own friend balance');

-- Host B sees nothing of A's ---------------------------------------------------
select tests.authenticate_as(:'b_id');
select is(count(*), 1::bigint, 'B sees only own profile') from public.profiles;
select is(id, :'b_id'::uuid, 'B''s visible profile is B') from public.profiles;
select is(count(*), 0::bigint, 'B sees no friends') from public.friends;
select is(count(*), 0::bigint, 'B sees no telegram_chats') from public.telegram_chats;
select is(count(*), 0::bigint, 'B sees no recurring_expenses') from public.recurring_expenses;
select is(count(*), 0::bigint, 'B sees no receipts') from public.receipts;
select is(count(*), 0::bigint, 'B sees no receipt_shares') from public.receipt_shares;
select is(count(*), 0::bigint, 'B sees no payment_requests') from public.payment_requests;
select is(count(*), 0::bigint, 'B sees no bank_alerts') from public.bank_alerts;
select is(count(*), 0::bigint, 'B sees no payment_claims') from public.payment_claims;
select is(count(*), 0::bigint, 'B sees no reminders') from public.reminders;
select is(count(*), 0::bigint, 'B sees no ledger_events') from public.ledger_events;
select is(count(*), 0::bigint, 'B sees no inbound_email_routes') from public.inbound_email_routes;
select is(count(*), 0::bigint, 'B sees no friend_balances') from public.friend_balances;
select is(public.friend_balance(:'a_id', :'friend_id'), 0::bigint, 'friend_balance for A''s friend is 0 through B''s eyes (RLS)');

-- B cannot write rows owned by A -----------------------------------------------
select throws_ok(
  format('insert into public.friends (host_id, display_name) values (%L, %L)', :'a_id', 'Smuggled'),
  '42501', null, 'B cannot insert a friend for A');
select throws_ok(
  format('insert into public.receipts (host_id, title, source, service_charge_bps, gst_bps, subtotal, service_charge, gst, total, split_input) values (%L, %L, %L, 0, 0, 0, 0, 0, 0, %L)', :'a_id', 'x', 'manual', '{}'),
  '42501', null, 'B cannot insert a receipt for A');
select throws_ok(
  format('insert into public.ledger_events (host_id, friend_id, type, amount) values (%L, %L, %L, 1)', :'a_id', :'friend_id', 'credit'),
  '42501', null, 'B cannot insert a ledger event for A');
select throws_ok(
  format('insert into public.receipt_shares (receipt_id, host_id, amount) values (%L, %L, 1)', '11111111-1111-1111-1111-111111111111', :'b_id'),
  '23503', null, 'B cannot attach a share to A''s receipt (composite FK)');
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference) values (%L, %L, 1, %L)', :'b_id', :'friend_id', 'SLZZZZZZ'),
  '23503', null, 'B cannot request payment from A''s friend (composite FK)');
select throws_ok(
  format('insert into public.profiles (id, display_name) values (%L, %L)', :'a_id', 'x'),
  '42501', null, 'B cannot insert a profile for A');

with upd as (update public.friends set display_name = 'Hacked' returning 1)
select is(count(*), 0::bigint, 'B''s update touches none of A''s friends') from upd;
with upd as (update public.receipts set title = 'Hacked' returning 1)
select is(count(*), 0::bigint, 'B''s update touches none of A''s receipts') from upd;
with upd as (update public.payment_requests set status = 'cancelled', cancelled_at = now() returning 1)
select is(count(*), 0::bigint, 'B''s update touches none of A''s payment requests') from upd;
with upd as (update public.profiles set display_name = 'Hacked' where id = :'a_id' returning 1)
select is(count(*), 0::bigint, 'B''s update touches A''s profile not at all') from upd;
with del as (delete from public.receipts returning 1)
select is(count(*), 0::bigint, 'B''s delete removes none of A''s receipts') from del;
with del as (delete from public.telegram_chats returning 1)
select is(count(*), 0::bigint, 'B''s delete removes none of A''s telegram chats') from del;
select throws_ok('delete from public.friends', '42501', null, 'hosts cannot hard-delete friends (archive instead)');
select throws_ok(
  'select public.confirm_payment_claim(''66666666-6666-6666-6666-666666666666'')',
  'P0002', null, 'B cannot see A''s claims to confirm them');

-- B's own rows are fine ----------------------------------------------------------
select lives_ok(format('insert into public.friends (host_id, display_name) values (%L, %L)', :'b_id', 'Bob friend'), 'B can insert own friend');
select is(count(*), 1::bigint, 'B now sees exactly one friend') from public.friends;
select lives_ok(format('update public.profiles set display_name = %L where id = %L', 'Bob', :'b_id'), 'B can update own profile');
select is(display_name, 'Bob', 'B''s profile was updated') from public.profiles where id = :'b_id';

-- anon has no access at all ------------------------------------------------------
select tests.clear_auth();
set local role anon;
select throws_ok('select count(*) from public.friends', '42501', null, 'anon cannot read friends');
select throws_ok('select count(*) from public.ledger_events', '42501', null, 'anon cannot read ledger_events');
select throws_ok('select public.save_split(''{}''::jsonb, ''[]''::jsonb)', '42501', null, 'anon cannot call save_split');

select tests.clear_auth();
select is(count(*), 2::bigint, 'superuser (service role) sees every friend') from public.friends;

select * from finish();
rollback;
