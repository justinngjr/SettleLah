-- Telegram linking (Session G): the host's own Telegram account, deep-link
-- tokens, and friend-binding requests the host confirms before anything
-- changes. Also ties payment requests to the receipt they came from so the
-- bot can find the group chat the bill was split in.

create type public.telegram_link_kind as enum ('host', 'group', 'friend');
create type public.telegram_binding_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- profiles: the host's Telegram user, so the bot can DM approval prompts.
-- One Telegram account can be at most one host.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column telegram_user_id bigint unique,
  add column telegram_username text;

-- ---------------------------------------------------------------------------
-- payment_requests.receipt_id: which split a request came from (optional).
-- The receipt's telegram_chat_id is the group the bot falls back to.
-- ---------------------------------------------------------------------------

alter table public.payment_requests
  add column receipt_id uuid,
  add constraint payment_requests_receipt_fkey
    foreign key (receipt_id, host_id) references public.receipts (id, host_id)
    on delete set null (receipt_id);

create index payment_requests_receipt_idx on public.payment_requests (receipt_id) where receipt_id is not null;

-- ---------------------------------------------------------------------------
-- reminders.escalated_at: the host is told once when the schedule runs out.
-- ---------------------------------------------------------------------------

alter table public.reminders
  add column escalated_at timestamptz;

-- ---------------------------------------------------------------------------
-- telegram_link_tokens: hashed deep-link payloads.
--   host   /start host_<token>        links the host's Telegram user (single use, 24h)
--   group  ?startgroup=grp_<token>    links a group chat to the host (single use, 24h)
--   friend /start fr_<token>          "Get private reminders" button on a split
--                                     message; every friend in the group taps the
--                                     same link, so it is multi-use until it expires
-- Only sha256(token) is stored; the plaintext lives in the URL alone.
-- ---------------------------------------------------------------------------

create table public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  kind public.telegram_link_kind not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- friend tokens: the split the button was posted with (narrows "which one are you?")
  receipt_id uuid,
  single_use boolean not null default true,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint telegram_link_tokens_receipt_fkey
    foreign key (receipt_id, host_id) references public.receipts (id, host_id) on delete cascade,
  constraint telegram_link_tokens_receipt_only_for_friends check (kind = 'friend' or receipt_id is null)
);

create index telegram_link_tokens_host_idx on public.telegram_link_tokens (host_id);

-- ---------------------------------------------------------------------------
-- telegram_binding_requests: "Link @user to Sarah?" awaiting the host's tap.
-- Created when a Telegram user presses "That's me (Sarah)" in the group or
-- picks themselves after the private deep link. Approving writes
-- friends.telegram_user_id (+ private_chat_started when they came privately).
-- host_message_id is null while the host has no Telegram linked yet; the web
-- inbox (listPendingBindings) shows those.
-- ---------------------------------------------------------------------------

create table public.telegram_binding_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null,
  telegram_user_id bigint not null,
  telegram_username text,
  telegram_first_name text,
  via_private_chat boolean not null default false,
  source_chat_id bigint,
  host_message_id bigint,
  status public.telegram_binding_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint telegram_binding_requests_friend_fkey
    foreign key (friend_id, host_id) references public.friends (id, host_id) on delete cascade,
  constraint telegram_binding_requests_resolved_at_matches_status check (
    (status = 'pending') = (resolved_at is null)
  )
);

create unique index telegram_binding_requests_one_pending
  on public.telegram_binding_requests (friend_id, telegram_user_id) where status = 'pending';
create index telegram_binding_requests_pending_idx
  on public.telegram_binding_requests (host_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- RLS: same owner policies as every other host table. The bot itself uses the
-- service role.
-- ---------------------------------------------------------------------------

alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_link_tokens force row level security;
create policy telegram_link_tokens_select_own on public.telegram_link_tokens
  for select to authenticated using (host_id = (select auth.uid()));
create policy telegram_link_tokens_insert_own on public.telegram_link_tokens
  for insert to authenticated with check (host_id = (select auth.uid()));
create policy telegram_link_tokens_update_own on public.telegram_link_tokens
  for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy telegram_link_tokens_delete_own on public.telegram_link_tokens
  for delete to authenticated using (host_id = (select auth.uid()));

alter table public.telegram_binding_requests enable row level security;
alter table public.telegram_binding_requests force row level security;
create policy telegram_binding_requests_select_own on public.telegram_binding_requests
  for select to authenticated using (host_id = (select auth.uid()));
create policy telegram_binding_requests_insert_own on public.telegram_binding_requests
  for insert to authenticated with check (host_id = (select auth.uid()));
create policy telegram_binding_requests_update_own on public.telegram_binding_requests
  for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy telegram_binding_requests_delete_own on public.telegram_binding_requests
  for delete to authenticated using (host_id = (select auth.uid()));

revoke all on public.telegram_link_tokens, public.telegram_binding_requests from anon;
