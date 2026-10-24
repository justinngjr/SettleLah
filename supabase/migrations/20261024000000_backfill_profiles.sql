-- Backfill profiles for auth users that never got one.
--
-- `handle_new_user` creates the profile row at sign-up, but accounts that
-- predate the trigger (or were created while this schema was being applied over
-- an existing project) have no row. Onboarding can only reach `updateProfile`,
-- and before the matching code change that was a strict UPDATE, so those hosts
-- were permanently stuck on "Could not save your profile. Try again." with
-- PostgREST PGRST116 ("The result contains 0 rows").
--
-- profiles is FORCE ROW LEVEL SECURITY, which binds the table owner too, so lift
-- the flag for the insert and restore it immediately after. Migrations run in a
-- single transaction, so the table is never unprotected outside this statement
-- pair.
alter table public.profiles no force row level security;

insert into public.profiles (id, display_name)
select u.id, nullif(u.raw_user_meta_data ->> 'display_name', '')
from auth.users u
on conflict (id) do nothing;

alter table public.profiles force row level security;
