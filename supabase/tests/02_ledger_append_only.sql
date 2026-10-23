begin;
\ir lib/helpers.psql
select plan(13);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_friend(:'a_id', 'Friend') as id \gset friend_

select tests.authenticate_as(:'a_id');
insert into public.ledger_events (id, host_id, friend_id, type, amount)
  values ('44444444-4444-4444-4444-444444444444', :'a_id', :'friend_id', 'expense_share', 1234);

-- As the host (authenticated role): no privilege, no policy.
select throws_ok(
  'update public.ledger_events set amount = 1 where id = ''44444444-4444-4444-4444-444444444444''',
  '42501', null, 'host cannot UPDATE ledger_events');
select throws_ok(
  'delete from public.ledger_events where id = ''44444444-4444-4444-4444-444444444444''',
  '42501', null, 'host cannot DELETE ledger_events');
select throws_ok('truncate public.ledger_events', '42501', null, 'host cannot TRUNCATE ledger_events');

-- As the service role: privilege revoked.
select tests.clear_auth();
set local role service_role;
select throws_ok(
  'update public.ledger_events set note = ''x'' where id = ''44444444-4444-4444-4444-444444444444''',
  '42501', null, 'service role cannot UPDATE ledger_events');
select throws_ok(
  'delete from public.ledger_events where id = ''44444444-4444-4444-4444-444444444444''',
  '42501', null, 'service role cannot DELETE ledger_events');
select lives_ok(
  format('insert into public.ledger_events (host_id, friend_id, type, amount, created_by) values (%L, %L, ''payment'', 234, ''system'')', :'a_id', :'friend_id'),
  'service role can still append');

-- As the superuser: the trigger is the last line of defence.
select tests.clear_auth();
select throws_ok(
  'update public.ledger_events set amount = 1 where id = ''44444444-4444-4444-4444-444444444444''',
  '23001', 'ledger_events is append-only (UPDATE not allowed)', 'trigger rejects UPDATE even for superuser');
select throws_ok(
  'delete from public.ledger_events where id = ''44444444-4444-4444-4444-444444444444''',
  '23001', 'ledger_events is append-only (DELETE not allowed)', 'trigger rejects DELETE even for superuser');
select throws_ok(
  format('delete from public.friends where id = %L', :'friend_id'),
  '23503', null, 'a friend with ledger history cannot be deleted');
select is(public.friend_balance(:'a_id', :'friend_id'), 1000::bigint, 'balance = 1234 expense - 234 payment');

-- Deleting the host account is the only way the events disappear (cascade).
select lives_ok(format('delete from auth.users where id = %L', :'a_id'), 'deleting the host account cascades');
select is(count(*), 0::bigint, 'ledger events went with the account') from public.ledger_events where host_id = :'a_id';
select is(count(*), 0::bigint, 'friends went with the account') from public.friends where host_id = :'a_id';

select * from finish();
rollback;
