begin;
\ir lib/helpers.psql
select plan(12);

-- Trigger functions are not callable through /rest/v1/rpc by the API roles.
select ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'), 'authenticated cannot execute handle_new_user');
select ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'), 'anon cannot execute handle_new_user');
select ok(not has_function_privilege('authenticated', 'public.ledger_events_immutable()', 'execute'), 'authenticated cannot execute ledger_events_immutable');
select ok(not has_function_privilege('anon', 'public.ledger_events_immutable()', 'execute'), 'anon cannot execute ledger_events_immutable');
select ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'), 'authenticated cannot execute set_updated_at');
select ok(not has_function_privilege('anon', 'public.set_updated_at()', 'execute'), 'anon cannot execute set_updated_at');
select ok(not has_function_privilege('authenticated', 'public.payment_claims_default_amount()', 'execute'), 'authenticated cannot execute payment_claims_default_amount');
select ok(not has_function_privilege('anon', 'public.payment_claims_default_amount()', 'execute'), 'anon cannot execute payment_claims_default_amount');

-- The triggers themselves still fire for the table owner.
select tests.create_host('a@test.local') as id \gset a_
select is(count(*), 1::bigint, 'handle_new_user still creates the profile') from public.profiles where id = :'a_id';
select tests.create_friend(:'a_id', 'Sarah') as id \gset sarah_
update public.friends set updated_at = '2000-01-01 00:00+00' where id = :'sarah_id';
select ok(updated_at > '2000-01-01 00:00+00'::timestamptz, 'set_updated_at still fires and overrides the stamp') from public.friends where id = :'sarah_id';

-- The runner RPC is service-role only.
select ok(not has_function_privilege('authenticated', 'public.run_recurring_expense(uuid, text, jsonb, jsonb, timestamptz)', 'execute'), 'authenticated cannot execute run_recurring_expense');
select ok(has_function_privilege('service_role', 'public.run_recurring_expense(uuid, text, jsonb, jsonb, timestamptz)', 'execute'), 'service_role can execute run_recurring_expense');

select * from finish();
rollback;
