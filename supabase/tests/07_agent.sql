begin;
\ir lib/helpers.psql
select plan(17);

select tests.create_host('a@test.local') as id \gset a_
select tests.create_host('b@test.local') as id \gset b_

-- A creates a conversation, a message and a pending action ---------------------------
select tests.authenticate_as(:'a_id');
insert into public.agent_conversations (id, host_id, title) values ('d0000000-0000-0000-0000-000000000001', :'a_id', 'Dinner');
insert into public.agent_messages (conversation_id, host_id, role, content) values ('d0000000-0000-0000-0000-000000000001', :'a_id', 'user', 'split this receipt');
insert into public.agent_actions (id, conversation_id, host_id, tool_call_id, tool, input, preview, preview_hash)
  values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', :'a_id', 'call_1', 'add_friend',
          '{"name":"Sarah"}', '{"title":"Add friend: Sarah"}', repeat('a', 64));
select lives_ok('select 1', 'host inserts conversation, message and pending action');

select is(status, 'pending'::public.agent_action_status, 'new action is pending') from public.agent_actions where id = 'e0000000-0000-0000-0000-000000000001';
select is(expires_at, created_at + interval '30 minutes', 'expires 30 minutes after creation') from public.agent_actions where id = 'e0000000-0000-0000-0000-000000000001';

-- Constraints --------------------------------------------------------------------
select throws_ok(
  format('insert into public.agent_actions (conversation_id, host_id, tool_call_id, tool, input, preview, preview_hash) values (%L, %L, %L, %L, %L, %L, %L)',
         'd0000000-0000-0000-0000-000000000001', :'a_id', 'call_2', 'add_friend', '{}', '{}', 'nothex'),
  '23514', null, 'preview_hash must be sha256 hex');
select throws_ok(
  format('update public.agent_actions set status = %L where id = %L', 'executed', 'e0000000-0000-0000-0000-000000000001'),
  '23514', null, 'executed requires executed_at');
select throws_ok(
  format('update public.agent_actions set result = %L where id = %L', '{"ok":true}', 'e0000000-0000-0000-0000-000000000001'),
  '23514', null, 'result only on executed actions');
select throws_ok(
  format('insert into public.agent_messages (conversation_id, host_id, role, content) values (%L, %L, %L, %L)',
         'd0000000-0000-0000-0000-000000000001', :'a_id', 'tool', 'x'),
  '23514', null, 'tool message needs tool_call_id');
update public.agent_actions set status = 'executed', executed_at = now(), resolved_at = now(), result = '{"friendId":"x"}'
  where id = 'e0000000-0000-0000-0000-000000000001';
select is(status, 'executed'::public.agent_action_status, 'executed with executed_at, resolved_at and result is accepted') from public.agent_actions where id = 'e0000000-0000-0000-0000-000000000001';

-- Host isolation -----------------------------------------------------------------
insert into public.agent_actions (id, conversation_id, host_id, tool_call_id, tool, input, preview, preview_hash)
  values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', :'a_id', 'call_3', 'add_friend',
          '{"name":"Dan"}', '{"title":"Add friend: Dan"}', repeat('b', 64));

select tests.authenticate_as(:'b_id');
select is(count(*), 0::bigint, 'B sees none of A''s conversations') from public.agent_conversations;
select is(count(*), 0::bigint, 'B sees none of A''s messages') from public.agent_messages;
select is(count(*), 0::bigint, 'B sees none of A''s actions') from public.agent_actions;
update public.agent_actions set status = 'approved' where id = 'e0000000-0000-0000-0000-000000000002';
select tests.clear_auth();
select is(status, 'pending'::public.agent_action_status, 'B cannot approve A''s action (RLS update is a no-op)') from public.agent_actions where id = 'e0000000-0000-0000-0000-000000000002';

-- B cannot attach rows to A's conversation, even with their own host_id
select tests.authenticate_as(:'b_id');
select throws_ok(
  format('insert into public.agent_messages (conversation_id, host_id, role, content) values (%L, %L, %L, %L)', 'd0000000-0000-0000-0000-000000000001', :'b_id', 'user', 'hi'),
  '23503', null, 'composite FK: B cannot add a message to A''s conversation');
select throws_ok(
  format('insert into public.agent_actions (conversation_id, host_id, tool_call_id, tool, input, preview, preview_hash) values (%L, %L, %L, %L, %L, %L, %L)',
         'd0000000-0000-0000-0000-000000000001', :'b_id', 'call_9', 'add_friend', '{}', '{}', repeat('c', 64)),
  '23503', null, 'composite FK: B cannot add an action to A''s conversation');
select throws_ok(
  format('insert into public.agent_conversations (host_id) values (%L)', :'a_id'),
  '42501', null, 'B cannot create a conversation owned by A');

-- Host cannot delete the audit trail directly; it goes with the conversation
select tests.authenticate_as(:'a_id');
select throws_ok('delete from public.agent_actions where id = ''e0000000-0000-0000-0000-000000000002''', '42501', null, 'host cannot delete actions directly');
delete from public.agent_conversations where id = 'd0000000-0000-0000-0000-000000000001';
select tests.clear_auth();
select is(count(*), 0::bigint, 'deleting the conversation cascades to its actions') from public.agent_actions;

select * from finish();
rollback;
