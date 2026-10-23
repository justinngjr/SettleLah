-- Recurring shared expenses: the run log that makes the hourly runner
-- idempotent, an optional linked Telegram group per expense, and the atomic
-- "run one period" RPC the runner calls.
--
--   * recurring_runs: one row per (recurring_expense_id, period_key). The
--     unique constraint is the idempotency key: a second run for the same
--     period inserts nothing and creates no receipt.
--   * recurring_expenses.telegram_chat_id: where the runner posts the split
--     after a run (nullable; the host picks one of their linked groups).
--   * run_recurring_expense(): inserts the run row, saves the split through
--     save_split (receipt + shares + expense_share ledger events) and advances
--     next_run_at, all in one transaction. Service role only; hosts read runs.
--
-- Expenses that have runs cannot be deleted (on delete restrict); hosts pause
-- them instead.

alter table public.recurring_expenses
  add column telegram_chat_id bigint,
  add constraint recurring_expenses_telegram_chat_fkey
    foreign key (host_id, telegram_chat_id)
    references public.telegram_chats (host_id, telegram_chat_id)
    on delete set null (telegram_chat_id);

create table public.recurring_runs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  recurring_expense_id uuid not null,
  -- 'YYYY-MM' for monthly, 'YYYY-MM-DD' (the run day, Asia/Singapore) for weekly.
  period_key text not null check (period_key ~ '^\d{4}-\d{2}(-\d{2})?$'),
  receipt_id uuid,
  ran_at timestamptz not null default now(),
  unique (recurring_expense_id, period_key),
  constraint recurring_runs_expense_fkey
    foreign key (recurring_expense_id, host_id)
    references public.recurring_expenses (id, host_id)
    on delete restrict,
  constraint recurring_runs_receipt_fkey
    foreign key (receipt_id, host_id)
    references public.receipts (id, host_id)
    on delete set null (receipt_id)
);

create index recurring_runs_host_idx on public.recurring_runs (host_id, ran_at desc);

alter table public.recurring_runs enable row level security;
alter table public.recurring_runs force row level security;
create policy recurring_runs_select_own on public.recurring_runs
  for select to authenticated using (host_id = (select auth.uid()));
revoke all on public.recurring_runs from anon;
revoke insert, update, delete, truncate on public.recurring_runs from authenticated;

-- ---------------------------------------------------------------------------
-- run_recurring_expense: one period of one recurring expense, atomically.
-- Returns the new receipt id, or null when this period already ran (nothing
-- is written in that case). The expense row is locked for the duration so
-- two overlapping runners cannot both pass the "already ran" check.
-- ---------------------------------------------------------------------------
create or replace function public.run_recurring_expense(
  p_recurring_expense_id uuid,
  p_period_key text,
  p_receipt jsonb,
  p_shares jsonb,
  p_next_run_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_host_id uuid := (p_receipt ->> 'hostId')::uuid;
  v_expense public.recurring_expenses%rowtype;
  v_run_id uuid;
  v_receipt_id uuid;
begin
  if v_host_id is null then
    raise exception 'run_recurring_expense: hostId is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_next_run_at is null then
    raise exception 'run_recurring_expense: next run is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_expense
  from public.recurring_expenses
  where id = p_recurring_expense_id and host_id = v_host_id
  for update;
  if not found then
    raise exception 'run_recurring_expense: recurring expense not found for this host' using errcode = 'no_data_found';
  end if;
  if not v_expense.active then
    raise exception 'run_recurring_expense: recurring expense is paused' using errcode = 'check_violation';
  end if;

  insert into public.recurring_runs (host_id, recurring_expense_id, period_key)
  values (v_host_id, p_recurring_expense_id, p_period_key)
  on conflict (recurring_expense_id, period_key) do nothing
  returning id into v_run_id;
  if v_run_id is null then
    return null;
  end if;

  v_receipt_id := public.save_split(
    p_receipt
      || jsonb_build_object('recurringExpenseId', p_recurring_expense_id)
      || jsonb_build_object('telegramChatId', v_expense.telegram_chat_id),
    p_shares
  );

  update public.recurring_runs set receipt_id = v_receipt_id where id = v_run_id;
  update public.recurring_expenses
    set next_run_at = p_next_run_at
    where id = p_recurring_expense_id and host_id = v_host_id;

  return v_receipt_id;
end;
$$;

revoke execute on function public.run_recurring_expense(uuid, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.run_recurring_expense(uuid, text, jsonb, jsonb, timestamptz) to service_role;
