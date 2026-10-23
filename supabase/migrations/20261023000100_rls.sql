-- Row level security: a host sees and writes only their own rows.
-- The service role (Telegram bot, webhooks, cron) bypasses RLS entirely.
--
-- Deliberate gaps:
--   * friends has no DELETE policy: friends are archived, never hard-deleted.
--   * ledger_events has no UPDATE/DELETE policy and the privileges are revoked
--     from every API role, on top of the ledger_events_immutable trigger.

-- Generic owner policies ----------------------------------------------------

create or replace function public.create_owner_policies(tbl regclass, allow_update boolean, allow_delete boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  name text := tbl::text;
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format(
    'create policy %I on %s for select to authenticated using (host_id = (select auth.uid()))',
    name || '_select_own', tbl);
  execute format(
    'create policy %I on %s for insert to authenticated with check (host_id = (select auth.uid()))',
    name || '_insert_own', tbl);
  if allow_update then
    execute format(
      'create policy %I on %s for update to authenticated using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()))',
      name || '_update_own', tbl);
  end if;
  if allow_delete then
    execute format(
      'create policy %I on %s for delete to authenticated using (host_id = (select auth.uid()))',
      name || '_delete_own', tbl);
  end if;
end;
$$;

select public.create_owner_policies('public.friends', true, false);
select public.create_owner_policies('public.telegram_chats', true, true);
select public.create_owner_policies('public.recurring_expenses', true, true);
select public.create_owner_policies('public.receipts', true, true);
select public.create_owner_policies('public.receipt_shares', true, true);
select public.create_owner_policies('public.payment_requests', true, true);
select public.create_owner_policies('public.bank_alerts', true, true);
select public.create_owner_policies('public.payment_claims', true, true);
select public.create_owner_policies('public.reminders', true, true);
select public.create_owner_policies('public.inbound_email_routes', true, true);
select public.create_owner_policies('public.ledger_events', false, false);

drop function public.create_owner_policies(regclass, boolean, boolean);

-- profiles is keyed by id, not host_id ---------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Privileges --------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke delete on public.friends from authenticated;
revoke update, delete, truncate on public.ledger_events from anon, authenticated, service_role;
