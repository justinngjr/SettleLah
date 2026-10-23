begin;
\ir lib/helpers.psql
select plan(26);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_

select tests.clear_auth();
select tests.create_friend(:'a_id', 'Sarah') as id \gset sarah_
select tests.create_friend(:'b_id', 'Bea') as id \gset bea_
insert into public.telegram_chats (host_id, telegram_chat_id, title) values (:'a_id', -1001, 'Dinner gang');
insert into public.receipts (id, host_id, title, source, service_charge_bps, gst_bps, subtotal, service_charge, gst, total, split_input, telegram_chat_id)
  values ('11111111-1111-1111-1111-111111111111', :'a_id', 'Supper', 'manual', 0, 0, 1000, 0, 0, 1000, '{}'::jsonb, -1001);

-- profiles.telegram_user_id: one Telegram account is at most one host ---------
update public.profiles set telegram_user_id = 777, telegram_username = 'alice' where id = :'a_id';
select is(telegram_user_id, 777::bigint, 'host A linked their Telegram user') from public.profiles where id = :'a_id';
select throws_ok(
  format('update public.profiles set telegram_user_id = 777 where id = %L', :'b_id'),
  '23505', null, 'a Telegram user cannot be linked to two hosts');

-- payment_requests.receipt_id ties the request to a split (same host only) ----
insert into public.payment_requests (id, host_id, friend_id, amount, reference, receipt_id)
  values ('22222222-2222-2222-2222-222222222222', :'a_id', :'sarah_id', 1000, 'SLABCDEF', '11111111-1111-1111-1111-111111111111');
select is(receipt_id, '11111111-1111-1111-1111-111111111111'::uuid, 'request links to its receipt') from public.payment_requests where id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  format('insert into public.payment_requests (host_id, friend_id, amount, reference, receipt_id) values (%L, %L, 500, ''SLBBBBBB'', ''11111111-1111-1111-1111-111111111111'')', :'b_id', :'bea_id'),
  '23503', null, 'a request cannot point at another host''s receipt');

-- reminders.escalated_at --------------------------------------------------------
insert into public.reminders (payment_request_id, host_id, next_at, escalated_at) values ('22222222-2222-2222-2222-222222222222', :'a_id', now(), now());
select is(count(*), 1::bigint, 'reminders can record the escalation') from public.reminders where escalated_at is not null;

-- telegram_link_tokens: hashed, kinds, expiry -------------------------------------
insert into public.telegram_link_tokens (id, host_id, kind, token_hash, expires_at)
  values ('33333333-3333-3333-3333-333333333331', :'a_id', 'host', repeat('a', 64), now() + interval '1 day');
insert into public.telegram_link_tokens (id, host_id, kind, token_hash, expires_at)
  values ('33333333-3333-3333-3333-333333333332', :'a_id', 'group', repeat('b', 64), now() + interval '1 day');
insert into public.telegram_link_tokens (id, host_id, kind, token_hash, receipt_id, single_use, expires_at)
  values ('33333333-3333-3333-3333-333333333333', :'a_id', 'friend', repeat('c', 64), '11111111-1111-1111-1111-111111111111', false, now() + interval '30 days');
select is(count(*), 3::bigint, 'three token kinds stored') from public.telegram_link_tokens;
select throws_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, expires_at) values (%L, ''host'', ''plaintext-token'', now())', :'a_id'),
  '23514', null, 'only sha256 hex digests are accepted as token hashes');
select throws_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, expires_at) values (%L, ''host'', %L, now())', :'a_id', repeat('a', 64)),
  '23505', null, 'token hashes are unique');
select throws_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, receipt_id, expires_at) values (%L, ''host'', %L, ''11111111-1111-1111-1111-111111111111'', now())', :'a_id', repeat('d', 64)),
  '23514', null, 'only friend tokens carry a receipt context');
select throws_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, receipt_id, expires_at) values (%L, ''friend'', %L, ''11111111-1111-1111-1111-111111111111'', now())', :'b_id', repeat('e', 64)),
  '23503', null, 'a friend token cannot reference another host''s receipt');

-- single use is a conditional update: the second consumer gets no row
with consumed as (
  update public.telegram_link_tokens set used_at = now()
  where token_hash = repeat('a', 64) and used_at is null and expires_at > now()
  returning id
) select is(count(*), 1::bigint, 'first consume of a single-use token succeeds') from consumed;
with consumed as (
  update public.telegram_link_tokens set used_at = now()
  where token_hash = repeat('a', 64) and used_at is null and expires_at > now()
  returning id
) select is(count(*), 0::bigint, 'second consume of a single-use token finds nothing') from consumed;

-- telegram_binding_requests ---------------------------------------------------------
insert into public.telegram_binding_requests (id, host_id, friend_id, telegram_user_id, telegram_username, via_private_chat)
  values ('44444444-4444-4444-4444-444444444441', :'a_id', :'sarah_id', 9001, 'sarah_t', false);
select throws_ok(
  format('insert into public.telegram_binding_requests (host_id, friend_id, telegram_user_id) values (%L, %L, 9001)', :'a_id', :'sarah_id'),
  '23505', null, 'one pending binding per friend + Telegram user');
select throws_ok(
  format('insert into public.telegram_binding_requests (host_id, friend_id, telegram_user_id) values (%L, %L, 9002)', :'b_id', :'sarah_id'),
  '23503', null, 'a binding cannot target another host''s friend');
select throws_ok(
  'update public.telegram_binding_requests set status = ''approved'' where id = ''44444444-4444-4444-4444-444444444441''',
  '23514', null, 'resolving a binding requires resolved_at');
update public.telegram_binding_requests set status = 'approved', resolved_at = now() where id = '44444444-4444-4444-4444-444444444441';
select lives_ok(
  format('insert into public.telegram_binding_requests (host_id, friend_id, telegram_user_id) values (%L, %L, 9001)', :'a_id', :'sarah_id'),
  'a new pending binding is allowed once the previous one is resolved');

-- RLS: host A sees own rows, host B none, anon nothing ---------------------------------
select tests.authenticate_as(:'a_id');
select is(count(*), 3::bigint, 'A sees own telegram_link_tokens') from public.telegram_link_tokens;
select is(count(*), 2::bigint, 'A sees own telegram_binding_requests') from public.telegram_binding_requests;
select is(telegram_user_id, 777::bigint, 'A sees own profile telegram_user_id') from public.profiles where id = :'a_id';
select lives_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, expires_at) values (%L, ''host'', %L, now() + interval ''1 day'')', :'a_id', repeat('f', 64)),
  'A can insert own token');
select throws_ok(
  format('insert into public.telegram_link_tokens (host_id, kind, token_hash, expires_at) values (%L, ''host'', %L, now() + interval ''1 day'')', :'b_id', repeat('0', 64)),
  '42501', null, 'A cannot insert a token for B');

select tests.authenticate_as(:'b_id');
select is(count(*), 0::bigint, 'B sees no telegram_link_tokens of A') from public.telegram_link_tokens;
select is(count(*), 0::bigint, 'B sees no telegram_binding_requests of A') from public.telegram_binding_requests;
with u as (
  update public.telegram_binding_requests set status = 'rejected', resolved_at = now() where host_id = :'a_id' returning id
) select is(count(*), 0::bigint, 'B cannot update A''s binding requests') from u;

select tests.clear_auth();
select set_config('role', 'anon', true);
select throws_ok('select count(*) from public.telegram_link_tokens', '42501', null, 'anon cannot read telegram_link_tokens');
select throws_ok('select count(*) from public.telegram_binding_requests', '42501', null, 'anon cannot read telegram_binding_requests');

select * from finish();
rollback;
