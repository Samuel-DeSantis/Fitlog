-- Optional, credential-free sanity check for supabase/schema.sql.
--
-- This is NOT part of `npm test` and does not touch a real Supabase
-- project — it runs supabase/schema.sql against a disposable local
-- Postgres (15+) with a minimal stand-in for Supabase's auth schema,
-- then exercises both the tenant-scoped foreign keys and the RLS
-- policies directly. It's a fast way to sanity-check the SQL itself
-- before touching a real project; it is not a substitute for
-- tests/integration/cloud-rls.integration.test.js, which is what
-- actually verifies a real Supabase project's PostgREST + GoTrue
-- behavior end to end.
--
-- Usage (any scratch Postgres 15+, e.g. a local `postgres` install):
--   createdb fitlog_verify
--   psql -d fitlog_verify -v ON_ERROR_STOP=1 -f supabase/local-verification.sql
--   # then read the output — every "expect ..." line's actual count/
--   # error should match what its \echo says.
--   dropdb fitlog_verify   # when done
--
-- ===== Part 1: minimal stand-in for what a real Supabase project =====
-- ===== already provides (auth.users, auth.uid(), roles)          =====

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- This is Supabase's actual auth.uid() implementation (reads the
-- request.jwt.claim.sub setting PostgREST populates from the caller's
-- verified JWT), reproduced here so RLS policies using auth.uid()
-- behave identically to a real project.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;

-- ===== Part 2: the actual schema under test =====
\ir schema.sql

-- ===== Part 3: tenant-scoped foreign key checks =====
-- (run as the table owner / superuser — these are DB-level constraint
-- checks, independent of RLS, so no role-switching needed here.)

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@verify.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@verify.local')
on conflict (id) do nothing;

insert into public.exercises (id, user_id, name) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Bench Press')
on conflict (id) do nothing;
insert into public.sessions (id, user_id, name) values
  ('a2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A Upper Day')
on conflict (id) do nothing;
insert into public.workouts (id, user_id, session_id, date, status) values
  ('a3333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a2222222-0000-0000-0000-000000000001', '2026-01-01', 'completed')
on conflict (id) do nothing;

\set ON_ERROR_STOP off

\echo '[FK 1/6] legit same-tenant set insert -> expect INSERT 1'
insert into public.sets (id, user_id, workout_id, exercise_id, set_order, weight, reps) values
  ('a4444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a3333333-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 0, 135, 8);

\echo '[FK 2/6] User B set pointing at A workout -> expect FK ERROR (sets_user_workout_fkey)'
insert into public.sets (id, user_id, workout_id, exercise_id, set_order) values
  ('b1111111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a3333333-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 0);

\echo '[FK 3/6] User B set pointing at A exercise -> expect FK ERROR (sets_user_exercise_fkey)'
insert into public.workouts (id, user_id, date, status) values
  ('b5555555-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-01-05', 'active')
on conflict (id) do nothing;
insert into public.sets (id, user_id, workout_id, exercise_id, set_order) values
  ('b6666666-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'b5555555-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001', 0);

\echo '[FK 4/6] User B workout pointing at A session -> expect FK ERROR (workouts_user_session_fkey)'
insert into public.workouts (id, user_id, session_id, date, status) values
  ('b2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'a2222222-0000-0000-0000-000000000001', '2026-01-02', 'active');

\echo '[FK 5/6] User B calendar_entry pointing at A session -> expect FK ERROR (calendar_entries_user_session_fkey)'
insert into public.calendar_entries (id, user_id, date, session_id) values
  ('b3333333-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-01-03', 'a2222222-0000-0000-0000-000000000001');

\echo '[FK 6/6] User B calendar_entry pointing at A workout -> expect FK ERROR (calendar_entries_user_workout_fkey)'
insert into public.calendar_entries (id, user_id, date, workout_id) values
  ('b4444444-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-01-04', 'a3333333-0000-0000-0000-000000000001');

\echo '[FK sanity] deleting A session sets ONLY workouts.session_id to null, never workouts.user_id -> expect user_id unchanged, session_id null'
delete from public.sessions where id = 'a2222222-0000-0000-0000-000000000001';
select id, user_id, session_id from public.workouts where id = 'a3333333-0000-0000-0000-000000000001';

\echo '[FK sanity] deleting A workout cascades to its sets -> expect count 1 then 0'
select count(*) from public.sets where workout_id = 'a3333333-0000-0000-0000-000000000001';
delete from public.workouts where id = 'a3333333-0000-0000-0000-000000000001';
select count(*) from public.sets where workout_id = 'a3333333-0000-0000-0000-000000000001';

-- ===== Part 4: RLS checks (as the `authenticated` role, simulating =====
-- ===== a real PostgREST request's verified JWT sub claim)          =====

insert into public.exercises (id, user_id, name) values
  ('b1111111-0000-0000-0000-000000000099', '22222222-2222-2222-2222-222222222222', 'B Bench Press')
on conflict (id) do nothing;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '[RLS 1/6] A selects own exercise -> expect count 1'
select count(*) from public.exercises where id = 'a1111111-0000-0000-0000-000000000001';

\echo '[RLS 2/6] A selects B exercise -> expect count 0 (silently filtered)'
select count(*) from public.exercises where id = 'b1111111-0000-0000-0000-000000000099';

\echo '[RLS 3/6] A updates B exercise -> expect UPDATE 0'
update public.exercises set name = 'HACKED' where id = 'b1111111-0000-0000-0000-000000000099';

\echo '[RLS 4/6] A deletes B exercise -> expect DELETE 0'
delete from public.exercises where id = 'b1111111-0000-0000-0000-000000000099';

\echo '[RLS 5/6] A inserts a row claiming to be Bs -> expect RLS ERROR'
insert into public.exercises (id, user_id, name) values
  ('a9999999-0000-0000-0000-000000000099', '22222222-2222-2222-2222-222222222222', 'Spoofed');

reset role;
reset request.jwt.claim.sub;
set role anon;
\echo '[RLS 6/6] anon (no session) selects everything -> expect count 0'
select count(*) from public.exercises;
reset role;
