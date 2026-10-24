begin;
\ir lib/helpers.psql
select plan(4);

-- Google sign-in: raw_user_meta_data carries full_name / name, no display_name.
create or replace function tests.create_google_host(p_email text, p_meta jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(),
    '{"provider":"google","providers":["google"]}'::jsonb, p_meta, now(), now(),
    '', '', '', '', false
  );
  return v_id;
end;
$$;

select tests.create_google_host('g1@test.local',
  '{"iss":"https://accounts.google.com","sub":"1","email":"g1@test.local","email_verified":true,"full_name":"Justin Ng","name":"Justin Ng","picture":"https://example.com/p.png"}'::jsonb) as id \gset g1_
select is(display_name, 'Justin Ng', 'profile display_name comes from full_name for Google users')
  from public.profiles where id = :'g1_id';

select tests.create_google_host('g2@test.local', '{"name":"Only Name"}'::jsonb) as id \gset g2_
select is(display_name, 'Only Name', 'falls back to name when full_name is absent')
  from public.profiles where id = :'g2_id';

select tests.create_google_host('g3@test.local', '{"display_name":"Chosen","full_name":"Google Name"}'::jsonb) as id \gset g3_
select is(display_name, 'Chosen', 'an explicit display_name still wins')
  from public.profiles where id = :'g3_id';

select tests.create_google_host('g4@test.local', '{"full_name":"  "}'::jsonb) as id \gset g4_
select is(display_name, null, 'blank names are stored as null so onboarding asks for one')
  from public.profiles where id = :'g4_id';

select * from finish();
rollback;
