-- Hosts now sign in with Google instead of an email magic link. Google (and
-- other OAuth providers) put the person's name in raw_user_meta_data as
-- `full_name` / `name`, never `display_name`, so the profile row created by
-- `handle_new_user` was always nameless. Prefer an explicit `display_name`
-- (kept for accounts created through the admin API), then the OAuth fields.
--
-- `create or replace` keeps the function's owner and privileges, so the
-- EXECUTE revoke from 20261023000650_harden_trigger_functions.sql still
-- applies; it is repeated below so this file stands on its own.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
