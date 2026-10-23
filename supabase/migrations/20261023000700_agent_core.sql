-- AI agent (Session J): chat conversations, their messages and the pending
-- ACTION CARDS the host approves before anything is written. Every write the
-- assistant proposes is stored here first; the approve endpoint re-runs the
-- tool's preview, compares `preview_hash`, and only then executes the tool
-- exactly once. The agent never executes a write inside the chat loop.
--
-- Ownership follows the existing tables: `host_id` on every row, composite
-- (id, host_id) foreign keys so a child can never point at another host's
-- parent, and per-host RLS policies.

create type public.agent_message_role as enum ('user', 'assistant', 'tool');
create type public.agent_action_status as enum ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired');

-- ---------------------------------------------------------------------------
-- agent_conversations: one chat thread
-- ---------------------------------------------------------------------------

create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, host_id)
);

create index agent_conversations_host_idx on public.agent_conversations (host_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- agent_messages: the transcript, including tool calls and their results.
--   user       content = what the host typed (image data is never stored)
--   assistant  content = reply text; tool_calls = [{id, name, arguments}]
--   tool       tool_call_id = which call; tool_result = the data returned
-- `seq` orders messages within a conversation independently of clock skew.
-- ---------------------------------------------------------------------------

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  seq bigint generated always as identity,
  role public.agent_message_role not null,
  content text not null default '',
  tool_calls jsonb,
  tool_call_id text,
  tool_result jsonb,
  created_at timestamptz not null default now(),
  constraint agent_messages_conversation_fkey
    foreign key (conversation_id, host_id) references public.agent_conversations (id, host_id) on delete cascade,
  constraint agent_messages_tool_fields check (
    (role = 'tool') = (tool_call_id is not null)
  ),
  constraint agent_messages_tool_calls_role check (
    tool_calls is null or role = 'assistant'
  )
);

create index agent_messages_conversation_idx on public.agent_messages (conversation_id, seq);

-- ---------------------------------------------------------------------------
-- agent_actions: a proposed write, waiting for one tap.
--   input         the validated tool arguments (JSON)
--   preview       what the host saw when they approved
--   preview_hash  sha256 of the canonical preview; approval re-computes it
--   expires_at    created_at + 30 minutes; a pending card past this is expired
--   result        the tool's return value once executed; `error` when failed
-- ---------------------------------------------------------------------------

create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  tool_call_id text not null,
  tool text not null,
  input jsonb not null,
  preview jsonb not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  status public.agent_action_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  result jsonb,
  error text,
  executed_at timestamptz,
  resolved_at timestamptz,
  constraint agent_actions_conversation_fkey
    foreign key (conversation_id, host_id) references public.agent_conversations (id, host_id) on delete cascade,
  constraint agent_actions_executed_at_matches_status check (
    (status = 'executed') = (executed_at is not null)
  ),
  constraint agent_actions_resolved_at_matches_status check (
    (status in ('pending', 'approved')) = (resolved_at is null)
  ),
  constraint agent_actions_result_only_when_executed check (
    result is null or status = 'executed'
  ),
  constraint agent_actions_error_only_when_failed check (
    error is null or status = 'failed'
  )
);

create index agent_actions_conversation_idx on public.agent_actions (conversation_id, created_at);
create index agent_actions_pending_idx on public.agent_actions (host_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Row level security: same owner policies as the other host tables.
-- Messages and actions are never deleted by the host directly; they go with
-- the conversation (cascade). Actions are updated only through the approve /
-- reject endpoints, which run as the host (RLS applies).
-- ---------------------------------------------------------------------------

alter table public.agent_conversations enable row level security;
alter table public.agent_conversations force row level security;
create policy agent_conversations_select_own on public.agent_conversations for select to authenticated using (host_id = (select auth.uid()));
create policy agent_conversations_insert_own on public.agent_conversations for insert to authenticated with check (host_id = (select auth.uid()));
create policy agent_conversations_update_own on public.agent_conversations for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy agent_conversations_delete_own on public.agent_conversations for delete to authenticated using (host_id = (select auth.uid()));

alter table public.agent_messages enable row level security;
alter table public.agent_messages force row level security;
create policy agent_messages_select_own on public.agent_messages for select to authenticated using (host_id = (select auth.uid()));
create policy agent_messages_insert_own on public.agent_messages for insert to authenticated with check (host_id = (select auth.uid()));

alter table public.agent_actions enable row level security;
alter table public.agent_actions force row level security;
create policy agent_actions_select_own on public.agent_actions for select to authenticated using (host_id = (select auth.uid()));
create policy agent_actions_insert_own on public.agent_actions for insert to authenticated with check (host_id = (select auth.uid()));
create policy agent_actions_update_own on public.agent_actions for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));

revoke delete on public.agent_messages, public.agent_actions from anon, authenticated;
