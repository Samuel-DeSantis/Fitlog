-- FitLog — Supabase schema + Row Level Security + tenant-scoped
-- relationship integrity
--
-- Run this once in your Supabase project's SQL Editor (or via the CLI:
-- `supabase db execute -f supabase/schema.sql`). It is written to be
-- safe to re-run on either a brand-new project OR one that already ran
-- an earlier version of this same file — every statement is
-- create-if-missing or drop-then-recreate, never destructive of rows.
-- There is no separate migrations/ directory for this project (see
-- docs/cloud-setup.md); this single script is the whole schema.
--
-- Requires PostgreSQL 15+ (for the `ON DELETE SET NULL (column_list)`
-- syntax used below). Supabase's hosted platform and self-hosted image
-- have both been on Postgres 15 or newer since well before this file
-- was written, so this should never be a real constraint in practice.
--
-- Mapping notes (see js/cloud/backup.js and js/cloud/restore.js for the
-- authoritative JS-side field mapping):
--   - Every table mirrors one existing IndexedDB object store 1:1 —
--     nothing here invents a data model the local app doesn't have.
--   - Local stable UUIDs (crypto.randomUUID(), see js/utils.js) are
--     reused as the primary key here, unchanged — never regenerated.
--   - Session "exercises" (the prescription list: exerciseId, targetSets,
--     repMin, repMax) stays an embedded jsonb array, exactly like it's
--     an embedded array field on the local Session record rather than
--     its own IndexedDB store. Same for a Workout's exercise_order.
--   - Dates (workouts.date, calendar_entries.date) are stored as plain
--     text in local 'YYYY-MM-DD' form rather than a `date` column, so a
--     restore round-trip can never re-format them differently than the
--     app itself would.
--   - Ownership is `user_id uuid references auth.users(id)`, always
--     stamped server-side from the authenticated session on the client
--     (see backup.js) and, more importantly, enforced by the RLS
--     policies below regardless of what a client sends.
--   - Cross-entity relationships (a workout's session, a set's workout/
--     exercise, a calendar entry's session/workout) are tenant-scoped
--     composite foreign keys, not plain id references — see the
--     "Tenant-scoped relationship integrity" section below for why.

-- ---------------------------------------------------------------------
-- exercises (parent of: sets)
-- ---------------------------------------------------------------------
create table if not exists public.exercises (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  primary_muscles jsonb not null default '[]'::jsonb,
  secondary_muscles jsonb not null default '[]'::jsonb,
  equipment text not null default '',
  movement_type text not null default '',
  archived boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz
);
create index if not exists exercises_user_id_idx on public.exercises (user_id);

-- ---------------------------------------------------------------------
-- sessions (a reusable prescription/template — NOT a performed workout)
-- (parent of: workouts, calendar_entries)
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  -- [{ exerciseId, targetSets, repMin, repMax }, ...], order = exercise order
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);
create index if not exists sessions_user_id_idx on public.sessions (user_id);

-- ---------------------------------------------------------------------
-- workouts (an actual performed — or in-progress — instance)
-- (child of: sessions; parent of: sets, calendar_entries)
-- ---------------------------------------------------------------------
create table if not exists public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid, -- tenant-scoped FK added below, not inline — see notes
  title text,
  date text not null, -- local 'YYYY-MM-DD', not a SQL date — see notes above
  status text not null check (status in ('active', 'completed')),
  exercise_order jsonb not null default '[]'::jsonb,
  notes text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create index if not exists workouts_user_id_idx on public.workouts (user_id);
create index if not exists workouts_date_idx on public.workouts (date);
create index if not exists workouts_status_idx on public.workouts (status);

-- ---------------------------------------------------------------------
-- sets (actual logged weight/reps for one exercise in one workout)
-- (child of: workouts, exercises)
-- ---------------------------------------------------------------------
create table if not exists public.sets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null, -- tenant-scoped FK added below, not inline
  exercise_id uuid not null, -- tenant-scoped FK added below, not inline
  set_order integer not null,
  weight numeric,
  reps integer,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);
create index if not exists sets_user_id_idx on public.sets (user_id);
create index if not exists sets_workout_id_idx on public.sets (workout_id);
create index if not exists sets_exercise_id_idx on public.sets (exercise_id);
-- Added after the initial Phase 6 rollout (sets previously had no
-- updated_at at all — see docs/cloud-setup.md's timestamp review) —
-- IF NOT EXISTS so this safely no-ops on a project that already has it.
alter table public.sets add column if not exists created_at timestamptz;
alter table public.sets add column if not exists updated_at timestamptz;

-- ---------------------------------------------------------------------
-- calendar_entries (a planned/scheduled occurrence, distinct from the
-- workout it may eventually produce)
-- (child of: sessions, workouts)
-- ---------------------------------------------------------------------
create table if not exists public.calendar_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null, -- local 'YYYY-MM-DD' — see notes above
  session_id uuid, -- tenant-scoped FK added below, not inline
  workout_id uuid, -- tenant-scoped FK added below, not inline
  created_at timestamptz,
  updated_at timestamptz
);
create index if not exists calendar_entries_user_id_idx on public.calendar_entries (user_id);
create index if not exists calendar_entries_date_idx on public.calendar_entries (date);

-- ---------------------------------------------------------------------
-- user_settings (unit + bodyweight — singleton per user, keyed by
-- user_id itself rather than the local fixed id 'app', which has no
-- meaning once more than one person's data lives in this table)
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unit text not null default 'lb',
  bodyweight numeric,
  updated_at timestamptz
);

-- =======================================================================
-- Tenant-scoped relationship integrity
--
-- RLS (below) stops one user's *queries* from reaching another user's
-- rows. It does NOT stop a row from being CONSTRUCTED so that it
-- references another tenant's data in the first place — e.g. nothing
-- about RLS alone would reject a client (signed in as User B) writing
--   sets { user_id: B, workout_id: <a workout that actually belongs to A> }
-- since a plain `workout_id references public.workouts(id)` only checks
-- that *some* workout with that id exists — not whose it is.
--
-- The fix is the standard multi-tenant Postgres pattern: give each
-- parent table a UNIQUE(user_id, id) constraint (in addition to its
-- existing plain `id` primary key — the primary key itself is
-- untouched), then have every child's foreign key reference BOTH
-- columns: FOREIGN KEY (user_id, parent_id) REFERENCES parent(user_id,
-- id). That makes it a database-level impossibility — not just an RLS-
-- filtered impossibility — for a row to reference a parent owned by a
-- different user_id: the row literally cannot be inserted or updated
-- into that shape, regardless of policies, service-role access, or a
-- future bug in a policy definition.
--
-- Nullable FKs (workouts.session_id, calendar_entries.session_id/
-- workout_id) use `ON DELETE SET NULL (<col>)` — the PG15+ column-list
-- form — rather than plain `ON DELETE SET NULL`, which for a composite
-- FK would null out ALL referencing columns, including user_id. That
-- would silently orphan a row's own tenant ownership, which must never
-- happen; only the single relationship column is nulled.
-- =======================================================================

-- Two phases, deliberately: dropping is children-before-parents (a
-- composite FK depends on its parent's UNIQUE(user_id, id) constraint,
-- so Postgres refuses to drop that constraint while any FK still
-- references it — the drops below fail if you swap this order),
-- adding is parents-before-children (a composite FK can't be created
-- until the UNIQUE constraint it references exists). This makes the
-- whole block safe to re-run on a project this already ran on before,
-- not just on a brand-new one.

-- ---- Phase 1: drop anything a previous run of this script (or a
-- pre-hardening version of it) may have already created ----
alter table public.workouts drop constraint if exists workouts_session_id_fkey; -- old single-column FK, pre-hardening
alter table public.workouts drop constraint if exists workouts_user_session_fkey;
alter table public.sets drop constraint if exists sets_workout_id_fkey; -- old single-column FK, pre-hardening
alter table public.sets drop constraint if exists sets_user_workout_fkey;
alter table public.sets drop constraint if exists sets_exercise_id_fkey; -- old single-column FK, pre-hardening
alter table public.sets drop constraint if exists sets_user_exercise_fkey;
alter table public.calendar_entries drop constraint if exists calendar_entries_session_id_fkey; -- old single-column FK, pre-hardening
alter table public.calendar_entries drop constraint if exists calendar_entries_user_session_fkey;
alter table public.calendar_entries drop constraint if exists calendar_entries_workout_id_fkey; -- old single-column FK, pre-hardening
alter table public.calendar_entries drop constraint if exists calendar_entries_user_workout_fkey;

alter table public.sessions drop constraint if exists sessions_user_id_id_key;
alter table public.workouts drop constraint if exists workouts_user_id_id_key;
alter table public.exercises drop constraint if exists exercises_user_id_id_key;

-- ---- Phase 2a: parents — back each referenced (user_id, id) pair
-- with a UNIQUE constraint child tables can point their composite FKs
-- at ----
alter table public.sessions add constraint sessions_user_id_id_key unique (user_id, id);
alter table public.workouts add constraint workouts_user_id_id_key unique (user_id, id);
alter table public.exercises add constraint exercises_user_id_id_key unique (user_id, id);

-- ---- Phase 2b: children — tenant-scoped composite foreign keys ----

-- workouts.session_id -> sessions(user_id, id), nullable
alter table public.workouts
  add constraint workouts_user_session_fkey
  foreign key (user_id, session_id) references public.sessions (user_id, id)
  on delete set null (session_id);
create index if not exists workouts_user_session_idx on public.workouts (user_id, session_id);

-- sets.workout_id -> workouts(user_id, id), not null
alter table public.sets
  add constraint sets_user_workout_fkey
  foreign key (user_id, workout_id) references public.workouts (user_id, id)
  on delete cascade;
create index if not exists sets_user_workout_idx on public.sets (user_id, workout_id);

-- sets.exercise_id -> exercises(user_id, id), not null
alter table public.sets
  add constraint sets_user_exercise_fkey
  foreign key (user_id, exercise_id) references public.exercises (user_id, id)
  on delete cascade;
create index if not exists sets_user_exercise_idx on public.sets (user_id, exercise_id);

-- calendar_entries.session_id -> sessions(user_id, id), nullable
alter table public.calendar_entries
  add constraint calendar_entries_user_session_fkey
  foreign key (user_id, session_id) references public.sessions (user_id, id)
  on delete set null (session_id);
create index if not exists calendar_entries_user_session_idx on public.calendar_entries (user_id, session_id);

-- calendar_entries.workout_id -> workouts(user_id, id), nullable
alter table public.calendar_entries
  add constraint calendar_entries_user_workout_fkey
  foreign key (user_id, workout_id) references public.workouts (user_id, id)
  on delete set null (workout_id);
create index if not exists calendar_entries_user_workout_idx on public.calendar_entries (user_id, workout_id);

-- =======================================================================
-- Row Level Security
--
-- Every table: RLS is enabled, and every policy checks auth.uid() —
-- the ID Supabase itself derives from the caller's verified JWT — never
-- a user_id value the client supplied. `using` gates which existing
-- rows a SELECT/UPDATE/DELETE can even see; `with check` gates what an
-- INSERT/UPDATE is allowed to write. Both are required: `using` alone
-- would still let a signed-in user INSERT a row claiming to belong to
-- someone else.
--
-- RLS and the composite foreign keys above are complementary, not
-- redundant: RLS is what makes another tenant's rows invisible/
-- unreachable to begin with; the composite FKs are what make it
-- impossible for a *visible, legitimately-owned* row to point at
-- someone else's parent even if a policy were ever misconfigured, or a
-- privileged (service-role) connection bypassed RLS entirely.
-- =======================================================================

alter table public.exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.workouts enable row level security;
alter table public.sets enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.user_settings enable row level security;

-- exercises
drop policy if exists exercises_select_own on public.exercises;
create policy exercises_select_own on public.exercises for select using (auth.uid() = user_id);
drop policy if exists exercises_insert_own on public.exercises;
create policy exercises_insert_own on public.exercises for insert with check (auth.uid() = user_id);
drop policy if exists exercises_update_own on public.exercises;
create policy exercises_update_own on public.exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists exercises_delete_own on public.exercises;
create policy exercises_delete_own on public.exercises for delete using (auth.uid() = user_id);

-- sessions
drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions for select using (auth.uid() = user_id);
drop policy if exists sessions_insert_own on public.sessions;
create policy sessions_insert_own on public.sessions for insert with check (auth.uid() = user_id);
drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions for delete using (auth.uid() = user_id);

-- workouts
drop policy if exists workouts_select_own on public.workouts;
create policy workouts_select_own on public.workouts for select using (auth.uid() = user_id);
drop policy if exists workouts_insert_own on public.workouts;
create policy workouts_insert_own on public.workouts for insert with check (auth.uid() = user_id);
drop policy if exists workouts_update_own on public.workouts;
create policy workouts_update_own on public.workouts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists workouts_delete_own on public.workouts;
create policy workouts_delete_own on public.workouts for delete using (auth.uid() = user_id);

-- sets
drop policy if exists sets_select_own on public.sets;
create policy sets_select_own on public.sets for select using (auth.uid() = user_id);
drop policy if exists sets_insert_own on public.sets;
create policy sets_insert_own on public.sets for insert with check (auth.uid() = user_id);
drop policy if exists sets_update_own on public.sets;
create policy sets_update_own on public.sets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sets_delete_own on public.sets;
create policy sets_delete_own on public.sets for delete using (auth.uid() = user_id);

-- calendar_entries
drop policy if exists calendar_entries_select_own on public.calendar_entries;
create policy calendar_entries_select_own on public.calendar_entries for select using (auth.uid() = user_id);
drop policy if exists calendar_entries_insert_own on public.calendar_entries;
create policy calendar_entries_insert_own on public.calendar_entries for insert with check (auth.uid() = user_id);
drop policy if exists calendar_entries_update_own on public.calendar_entries;
create policy calendar_entries_update_own on public.calendar_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists calendar_entries_delete_own on public.calendar_entries;
create policy calendar_entries_delete_own on public.calendar_entries for delete using (auth.uid() = user_id);

-- user_settings
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own on public.user_settings for delete using (auth.uid() = user_id);

-- Explicitly NOT created here (out of scope — see docs/cloud-setup.md):
-- no "authenticated users can do everything" broad policy, no
-- realtime publication changes, no triggers for automatic sync.
