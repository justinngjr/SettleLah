begin;
\ir lib/helpers.psql
select plan(23);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_

select tests.clear_auth();
select tests.create_friend(:'a_id', 'Sarah') as id \gset sarah_
select tests.create_friend(:'b_id', 'Bea') as id \gset bea_
insert into public.telegram_chats (host_id, telegram_chat_id, title) values (:'a_id', -1001, 'Flatmates');

insert into public.recurring_expenses (id, host_id, title, amount, cadence, anchor_day, participants, next_run_at, telegram_chat_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :'a_id', 'Netflix', 1790, 'monthly', 1,
          format('[{"id": "%s", "weight": 1}, {"id": "%s", "weight": 1}]', :'a_id', :'sarah_id')::jsonb,
          '2026-11-01 01:00+00', -1001);
insert into public.recurring_expenses (id, host_id, title, amount, cadence, anchor_day, participants, next_run_at)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', :'b_id', 'Cleaner', 8000, 'weekly', 1,
          format('[{"id": "%s", "weight": 1}]', :'bea_id')::jsonb, '2026-11-02 01:00+00');

-- telegram_chat_id must be one of the host's own linked groups --------------------
select throws_ok(
  format('update public.recurring_expenses set telegram_chat_id = -1001 where id = %L', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  '23503', null, 'an expense cannot link another host''s Telegram group');

-- run_recurring_expense: first run writes everything atomically -------------------
select public.run_recurring_expense(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11',
  format('{"hostId": "%s", "title": "Netflix", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
          "subtotal": 1790, "serviceCharge": 0, "gst": 0, "total": 1790, "splitInput": {}, "createdBy": "system"}', :'a_id')::jsonb,
  format('[{"friendId": null, "amount": 895}, {"friendId": "%s", "amount": 895}]', :'sarah_id')::jsonb,
  '2026-12-01 01:00+00'
) as id \gset receipt_

select ok(:'receipt_id'::uuid is not null, 'first run returns a receipt id');
select is(count(*), 1::bigint, 'one run row for the period') from public.recurring_runs where recurring_expense_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(receipt_id, :'receipt_id'::uuid, 'run row points at the receipt') from public.recurring_runs where period_key = '2026-11';
select is(recurring_expense_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'receipt carries recurring_expense_id') from public.receipts where id = :'receipt_id';
select is(telegram_chat_id, (-1001)::bigint, 'receipt inherits the linked group from the expense') from public.receipts where id = :'receipt_id';
select is(count(*), 2::bigint, 'host and friend shares stored') from public.receipt_shares where receipt_id = :'receipt_id';
select results_eq(
  format('select friend_id, type::text, amount, created_by::text from public.ledger_events where receipt_id = %L', :'receipt_id'),
  format('values (%L::uuid, ''expense_share'', 895::bigint, ''system'')', :'sarah_id'),
  'exactly one expense_share event, for the friend, created by system');
select is(next_run_at, '2026-12-01 01:00+00'::timestamptz, 'next_run_at advanced') from public.recurring_expenses where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- idempotent: the same period again writes nothing -----------------------------------
select is(
  public.run_recurring_expense(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11',
    format('{"hostId": "%s", "title": "Netflix", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
            "subtotal": 1790, "serviceCharge": 0, "gst": 0, "total": 1790, "splitInput": {}}', :'a_id')::jsonb,
    format('[{"friendId": null, "amount": 895}, {"friendId": "%s", "amount": 895}]', :'sarah_id')::jsonb,
    '2027-01-01 01:00+00'),
  null::uuid, 'second run for the same period returns null');
select is(count(*), 1::bigint, 'still one receipt for the expense') from public.receipts where recurring_expense_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(count(*), 1::bigint, 'still one ledger event') from public.ledger_events where receipt_id = :'receipt_id';
select is(next_run_at, '2026-12-01 01:00+00'::timestamptz, 'next_run_at untouched by the duplicate') from public.recurring_expenses where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- paused expenses do not run -------------------------------------------------------------
update public.recurring_expenses set active = false where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select throws_ok(
  format($q$select public.run_recurring_expense('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-12',
    '{"hostId": "%s", "title": "Netflix", "source": "manual", "serviceChargeBps": 0, "gstBps": 0, "subtotal": 1790, "serviceCharge": 0, "gst": 0, "total": 1790, "splitInput": {}}'::jsonb,
    '[{"friendId": null, "amount": 1790}]'::jsonb, '2027-01-01 01:00+00')$q$, :'a_id'),
  '23514', null, 'a paused expense refuses to run');
update public.recurring_expenses set active = true where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- cross-host: host B's id cannot run host A's expense --------------------------------------
select throws_ok(
  format($q$select public.run_recurring_expense('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-12',
    '{"hostId": "%s", "title": "Netflix", "source": "manual", "serviceChargeBps": 0, "gstBps": 0, "subtotal": 1790, "serviceCharge": 0, "gst": 0, "total": 1790, "splitInput": {}}'::jsonb,
    '[{"friendId": null, "amount": 1790}]'::jsonb, '2027-01-01 01:00+00')$q$, :'b_id'),
  'P0002', null, 'another host cannot run this expense');
select is(count(*), 1::bigint, 'no run row was written for the foreign attempt') from public.recurring_runs where recurring_expense_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- expenses with runs cannot be deleted ------------------------------------------------------
select throws_ok(
  'delete from public.recurring_expenses where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
  '23503', null, 'an expense with runs cannot be deleted');
select lives_ok(
  'delete from public.recurring_expenses where id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''',
  'an expense that never ran can be deleted');

-- RLS: hosts read their own runs only, and cannot write them ---------------------------------
select tests.authenticate_as(:'a_id');
select is(count(*), 1::bigint, 'A sees own recurring_runs') from public.recurring_runs;
select throws_ok(
  format('insert into public.recurring_runs (host_id, recurring_expense_id, period_key) values (%L, ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''2030-01'')', :'a_id'),
  '42501', null, 'hosts cannot insert run rows (runner only)');
select throws_ok(
  format($q$select public.run_recurring_expense('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2030-01',
    '{"hostId": "%s", "title": "x", "source": "manual", "serviceChargeBps": 0, "gstBps": 0, "subtotal": 1, "serviceCharge": 0, "gst": 0, "total": 1, "splitInput": {}}'::jsonb,
    '[{"friendId": null, "amount": 1}]'::jsonb, '2030-02-01 01:00+00')$q$, :'a_id'),
  '42501', null, 'authenticated hosts cannot call run_recurring_expense');
select tests.authenticate_as(:'b_id');
select is(count(*), 0::bigint, 'B sees none of A''s recurring_runs') from public.recurring_runs;
select is(count(*), 0::bigint, 'B sees none of A''s recurring expenses') from public.recurring_expenses;

select * from finish();
rollback;
