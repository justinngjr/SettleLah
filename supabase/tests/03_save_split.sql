begin;
\ir lib/helpers.psql
select plan(19);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_
select tests.create_friend(:'a_id', 'Bob') as id \gset bob_
select tests.create_friend(:'a_id', 'Cara') as id \gset cara_
select tests.create_friend(:'b_id', 'Stranger') as id \gset stranger_

select tests.authenticate_as(:'a_id');

-- Happy path: host share stored but not owed; zero-amount friend gets no event.
select public.save_split(
  format('{"hostId": "%s", "title": "Dinner", "source": "llm", "serviceChargeBps": 1000, "gstBps": 900,
          "subtotal": 10000, "serviceCharge": 1000, "gst": 990, "total": 11990,
          "interpretation": {"items": []}, "splitInput": {"items": []}}', :'a_id')::jsonb,
  format('[{"friendId": null, "amount": 3997, "itemsSubtotal": 3333},
          {"friendId": "%s", "amount": 7993, "itemsSubtotal": 6667},
          {"friendId": "%s", "amount": 0, "itemsSubtotal": 0, "paysNothing": true}]', :'bob_id', :'cara_id')::jsonb
) as id \gset receipt_

select is(count(*), 1::bigint, 'receipt inserted') from public.receipts where id = :'receipt_id';
select is(total, 11990::bigint, 'receipt total stored') from public.receipts where id = :'receipt_id';
select is(count(*), 3::bigint, 'three shares inserted (host + 2 friends)') from public.receipt_shares where receipt_id = :'receipt_id';
select is(amount, 3997::bigint, 'host share stored') from public.receipt_shares where receipt_id = :'receipt_id' and friend_id is null;
select is(pays_nothing, true, 'excluded friend flagged') from public.receipt_shares where receipt_id = :'receipt_id' and friend_id = :'cara_id';
select is(count(*), 1::bigint, 'exactly one ledger event (friend owing > 0)') from public.ledger_events where receipt_id = :'receipt_id';
select results_eq(
  format('select friend_id, type::text, amount from public.ledger_events where receipt_id = %L', :'receipt_id'),
  format('values (%L::uuid, ''expense_share'', 7993::bigint)', :'bob_id'),
  'ledger event is Bob''s expense_share for his amount');
select is(public.friend_balance(:'a_id', :'bob_id'), 7993::bigint, 'Bob owes his share');
select is(public.friend_balance(:'a_id', :'cara_id'), 0::bigint, 'Cara owes nothing');

-- Atomicity: a failure anywhere leaves nothing behind -------------------------
select count(*) as receipts from public.receipts \gset before_
select count(*) as shares from public.receipt_shares \gset before_
select count(*) as events from public.ledger_events \gset before_

select throws_ok(
  format($q$select public.save_split(
    '{"hostId": "%s", "title": "Bad sum", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
      "subtotal": 1000, "serviceCharge": 0, "gst": 0, "total": 1000, "splitInput": {}}'::jsonb,
    '[{"friendId": "%s", "amount": 999}]'::jsonb)$q$, :'a_id', :'bob_id'),
  '23514', 'save_split: shares sum to 999 but the receipt total is 1000', 'shares must sum to the total');

select throws_ok(
  format($q$select public.save_split(
    '{"hostId": "%s", "title": "Foreign friend", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
      "subtotal": 1000, "serviceCharge": 0, "gst": 0, "total": 1000, "splitInput": {}}'::jsonb,
    '[{"friendId": "%s", "amount": 600}, {"friendId": "%s", "amount": 400}]'::jsonb)$q$, :'a_id', :'bob_id', :'stranger_id'),
  '23503', null, 'a share for another host''s friend fails (FK), after the receipt insert');

select throws_ok(
  format($q$select public.save_split(
    '{"hostId": "%s", "title": "Not mine", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
      "subtotal": 1000, "serviceCharge": 0, "gst": 0, "total": 1000, "splitInput": {}}'::jsonb,
    '[{"friendId": "%s", "amount": 1000}]'::jsonb)$q$, :'b_id', :'stranger_id'),
  '42501', null, 'host A cannot save a split for host B (RLS)');

select throws_ok(
  format($q$select public.save_split(
    '{"hostId": "%s", "title": "Negative", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
      "subtotal": 0, "serviceCharge": 0, "gst": 0, "total": 0, "splitInput": {}}'::jsonb,
    '[{"friendId": "%s", "amount": -5}, {"friendId": "%s", "amount": 5}]'::jsonb)$q$, :'a_id', :'bob_id', :'cara_id'),
  '23514', null, 'negative share amounts are rejected');

select throws_ok(
  format($q$select public.save_split(
    '{"hostId": "%s", "title": "Empty", "source": "manual", "serviceChargeBps": 0, "gstBps": 0,
      "subtotal": 0, "serviceCharge": 0, "gst": 0, "total": 0, "splitInput": {}}'::jsonb,
    '[]'::jsonb)$q$, :'a_id'),
  '22023', null, 'shares must be non-empty');

select is(count(*), :'before_receipts'::bigint, 'failed calls inserted no receipts') from public.receipts;
select is(count(*), :'before_shares'::bigint, 'failed calls inserted no shares') from public.receipt_shares;
select is(count(*), :'before_events'::bigint, 'failed calls inserted no ledger events') from public.ledger_events;

-- Receipts referenced by the ledger cannot be deleted; unreferenced ones can.
select throws_ok(format('delete from public.receipts where id = %L', :'receipt_id'), '23503', null,
  'a receipt with ledger events cannot be deleted');
insert into public.receipts (id, host_id, title, source, service_charge_bps, gst_bps, subtotal, service_charge, gst, total, split_input)
  values ('55555555-5555-5555-5555-555555555555', :'a_id', 'Draft', 'manual', 0, 0, 0, 0, 0, 0, '{}'::jsonb);
select lives_ok('delete from public.receipts where id = ''55555555-5555-5555-5555-555555555555''', 'a receipt without ledger events can be deleted');

select * from finish();
rollback;
