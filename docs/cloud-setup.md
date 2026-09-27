# FitLog — Accounts + Cloud Foundation

This document covers everything needed to turn on cloud backup/restore
for a FitLog deployment, the security model (including a subsequent
hardening pass), and the architecture future sync work would build on.
FitLog itself needs none of this to run — signed out, with no Supabase
project configured at all, every existing feature (Today, Train,
Calendar, Progress, More) works exactly as before.

## Status

**Currently implemented:**
- Supabase authentication (sign up / sign in / sign out / session
  detection on boot)
- Explicit, user-initiated cloud backup
- Explicit, user-initiated cloud restore (merge or replace, with
  confirmation)
- Row Level Security on every table (`auth.uid() = user_id`)
- Tenant-scoped database relationships — composite foreign keys that
  make a cross-user reference a database-level impossibility, not just
  an RLS-filtered one (see §3)
- Security tests: unit-level ownership-stamping checks
  (`tests/cloud-security.test.js`), and a real-Supabase-project
  integration suite covering both RLS and cross-tenant FK rejection
  (`tests/integration/cloud-rls.integration.test.js`)

**Not currently implemented** (and not planned for this phase):
- Automatic or background synchronization
- Incremental sync (partial/changed-only pushes or pulls)
- Conflict resolution (a restore can overwrite a locally-newer record
  sharing an ID with an older cloud one — see §9)
- Realtime synchronization / live multi-device updates
- Multi-device automatic merging

If a description below implies more than this, that's a documentation
bug — file it as such.

## 1. One-time Supabase project setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run `supabase/schema.sql` from this repo. It
   creates six tables (`exercises`, `sessions`, `workouts`, `sets`,
   `calendar_entries`, `user_settings`), enables Row Level Security with
   an explicit policy per table, and adds the tenant-scoped composite
   foreign keys described in §3 — see that file's comments for the full
   mapping from IndexedDB stores to these tables. It's written to be
   safe to re-run, including on a project that already ran an earlier
   version of this same file (see §3 for why that matters).
3. In **Project Settings → API**, copy your **Project URL** and **anon
   / public key**.
4. Fill both into `js/cloud/config.js`:
   ```js
   window.FITLOG_SUPABASE_CONFIG = {
     url: 'https://xxxxxxxxxxxx.supabase.co',
     anonKey: 'ey...'
   };
   ```
   The anon key is safe to ship in frontend code — it only ever grants
   what the RLS policies allow (a signed-in user's own rows). **Never**
   put a service-role key anywhere in this app.
5. (Optional) In **Authentication → Providers → Email**, decide whether
   to require email confirmation. FitLog's sign-up flow handles both:
   if confirmation is required, the More screen tells the person to
   check their email instead of assuming they're signed in.

Leaving `js/cloud/config.js` blank is a supported configuration —
FitLog runs fully locally, and the More screen's Account section says
cloud sync isn't set up rather than showing broken sign-in fields.

## 2. What "local-first" means here

- Every existing command/query in `js/commands.js` / `js/queries.js` is
  completely unaware `App.cloud` exists. IndexedDB via `js/db.js`
  remains the only thing the rest of the app reads and writes.
- `App.cloud.auth.init()` runs once at boot (`js/app.js`), wrapped in a
  `try/catch` — if Supabase isn't configured, the SDK script didn't
  load, or the network is down, the app boots exactly as it always has.
- Backup and restore are both **explicit, user-initiated actions** in
  More → Account/Cloud. Nothing runs automatically or in the
  background.

## 3. Tenant-scoped relationship integrity

RLS (policies checking `auth.uid() = user_id`) stops one user's
*queries* from reaching another user's rows. On its own it does **not**
stop a row from being *constructed* to reference another tenant's data
in the first place — e.g. nothing about RLS alone rejects a client
(genuinely signed in as User B) writing a `sets` row with `user_id: B`
but `workout_id: <a workout that actually belongs to A>`: a plain
`workout_id references workouts(id)` foreign key only checks that
*some* workout with that id exists, not whose it is.

The fix, added in a hardening pass after the initial rollout, is the
standard multi-tenant Postgres pattern: every parent table
(`sessions`, `workouts`, `exercises`) has a `UNIQUE (user_id, id)`
constraint alongside its existing plain `id` primary key (which is
untouched), and every child's foreign key references **both** columns:
`FOREIGN KEY (user_id, parent_id) REFERENCES parent (user_id, id)`.
That makes a cross-tenant reference a database-level impossibility —
the row literally cannot be inserted or updated into that shape,
independent of RLS, a future policy bug, or a privileged connection
that bypasses RLS entirely.

Relationships protected this way:

| Child                        | Column        | Parent       |
|-------------------------------|---------------|--------------|
| `workouts`                    | `session_id`  | `sessions`   |
| `sets`                        | `workout_id`  | `workouts`   |
| `sets`                        | `exercise_id` | `exercises`  |
| `calendar_entries`             | `session_id`  | `sessions`   |
| `calendar_entries`             | `workout_id`  | `workouts`   |

Nullable relationships (`workouts.session_id`, both `calendar_entries`
columns) use `ON DELETE SET NULL (<column>)` — Postgres 15's
column-list form — rather than plain `ON DELETE SET NULL`, which for a
composite FK would null out **every** referencing column, including
`user_id`. That would silently strip a row of its own tenant ownership
when its parent is deleted, which must never happen; only the single
relationship column is ever nulled.

**RLS and these foreign keys are complementary, not redundant**: RLS is
what makes another tenant's rows invisible/unreachable to begin with;
the composite FKs are what make it impossible for a row to point at
someone else's parent even if a policy were ever misconfigured.

`supabase/schema.sql` is structured as two phases specifically so it
stays safe to re-run: drop old constraints children-before-parents
(a composite FK depends on its parent's `UNIQUE(user_id, id)`, so
Postgres refuses to drop that constraint while a FK still references
it), then add them back parents-before-children. This was verified,
not just reasoned about — see §7.3 for how.

## 4. Backup semantics

"Back Up Data" reads everything currently in IndexedDB
(`App.db.exportAll()` — the same function the existing JSON export
already uses) and **upserts** it into your Supabase tables, keyed by
each record's existing stable ID (or `user_id` for the `user_settings`
singleton). Repeated backups never create duplicates.

Backup is **additive only**. If a record exists in the cloud but not
locally (e.g. it was deleted on this device, or belongs to a different
device that hasn't synced yet), backing up from this device does
**not** delete it from the cloud. There is no bidirectional
reconciliation in this phase — see §6.

## 5. Restore semantics

"Restore from Cloud" fetches every row belonging to the signed-in user
across all six tables, maps it back to FitLog's local shape, and writes
it into IndexedDB via `App.db.importAll()` — the exact same validated,
atomic import path the existing JSON-file import already uses. That
gives cloud restore, for free:

- Full validation before anything is written (a malformed row rejects
  the whole restore, leaving local data completely untouched).
- The same merge-vs-replace choice as file import, via the same
  confirm() dialog wording, so the UX is consistent across both.
- No duplicate records on repeated restores (`put()`, not `add()`).

**Merge** (default) adds/updates records without first clearing
anything. **Replace** clears every local store first — the More screen
always asks for explicit confirmation before either runs, since even
merge can overwrite a locally-newer record sharing an ID with an
older cloud one (see §9's noted limitation).

## 6. Future sync — what's already in place, what's deliberately not built

This phase intentionally stops at explicit, one-way-at-a-time backup
and restore. The pieces a later phase would build automatic sync on top
of already exist:

- **Stable IDs** everywhere (`crypto.randomUUID()`, unchanged across
  local ↔ cloud).
- **Ownership** (`user_id`, RLS- and now FK-enforced — see §3) on every
  table.
- **`created_at` / `updated_at`** on every record, including `sets` and
  `user_settings` — see the timestamp review below.
- **Relationships preserved**, and now tenant-scoped (§3).

### Timestamp review (hardening pass)

Every entity was checked for whether its local model tracks a real
creation/modification time a future last-write-wins sync could compare:

| Entity            | created_at | updated_at | Notes |
|--------------------|:----------:|:----------:|-------|
| `exercises`        | ✅ | ✅ | stamped on create and on archive |
| `sessions`         | ✅ | ✅ | stamped on create, edit, and per-exercise prescription edit |
| `workouts`         | ✅ | ✅ | stamped on create and on every mutation (reorder, finish, etc.) |
| `calendar_entries` | ✅ | ✅ | stamped on create, edit, and when linked to a started workout |
| `sets`             | ✅ | ✅ | **added in this pass** — previously had neither field at all |
| `user_settings`    | n/a | ✅ | **fixed in this pass** — see below |

Two real inconsistencies were found and fixed, not merely documented,
because both were small, mechanical, and directly block a future
last-write-wins strategy without them:

- **Sets had no `updated_at` at all.** Editing an already-logged set's
  weight or reps left zero trace of when that edit happened —
  `completedAt` is semantically "when did this set become complete",
  not "when was this record last touched", and it wasn't refreshed on
  every edit either. Fixed: `js/commands.js`'s `addSet`, `updateSet`,
  `setSetCompleted`, and the prescribed-set builder used by
  `startFromSession` now all stamp `createdAt`/`updatedAt` the same way
  every other entity already did. `supabase/schema.sql`'s `sets` table
  gained matching columns (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
  so this safely upgrades an already-deployed project too).
- **`user_settings.updated_at` was stamped at backup time, not change
  time.** `js/cloud/backup.js` previously generated a fresh timestamp
  on every call to `backupAll()`, regardless of whether the bodyweight
  or unit had actually changed since the last backup — a snapshot
  operation was manufacturing a modification timestamp. Fixed:
  `setUnit`/`setBodyweight` in `js/commands.js` now stamp the local
  settings record's own `updatedAt` at the moment of the real change;
  backup carries that value through unchanged (falling back to "now"
  only for a legacy local record from before this fix that has never
  been touched since).

No other inconsistency was found worth a schema/model change; nothing
here was over-engineered — no sync logic, queue, or conflict resolution
was added, just the missing/incorrect timestamp inputs a later sync
phase would need.

### What a later phase could build on top

- **Automatic sync**: a periodic or on-change call to
  `App.cloud.backup.backupAll()` / a smarter incremental version that
  only pushes records changed since the last successful sync
  (`updated_at > lastSyncedAt`) — now meaningful for every entity,
  `sets` included.
- **Offline mutation queue**: record every local write's store+id while
  offline, then push just those rows once back online, instead of a
  full `exportAll()`.
- **Multi-device / conflict resolution**: since every record now has a
  real `updated_at`, the simplest strategy is **last-write-wins by
  timestamp** — compare local vs. cloud `updated_at` per record before
  overwriting either direction. A more careful approach would diff
  field-by-field (e.g. a Session's `exercises` array) rather than
  whole-record LWW, especially for anything edited on two devices while
  offline.
- **Realtime**: Supabase's realtime subscriptions could push a
  "something changed elsewhere" signal to trigger a background sync,
  rather than requiring the person to open More and tap the buttons.

None of the above is implemented now — see the Status section above.

## 7. Security review checklist

- [x] No service-role key exists anywhere in this app —
  `js/cloud/config.js` only ever holds the public anon key.
- [x] RLS is enabled on all six tables (`supabase/schema.sql`).
- [x] Every RLS policy checks `auth.uid() = user_id` — never a
  client-supplied value. `with check` (not just `using`) is present on
  every insert/update policy, so a client cannot insert or reassign a
  row to another user's `user_id`.
- [x] Tenant-scoped composite foreign keys make a cross-user parent
  reference impossible at the database level, independent of RLS (§3).
- [x] `js/cloud/backup.js`'s row mappers always take `user_id` as an
  explicit argument (the authenticated session's own id) and never read
  it from the local record — see `tests/cloud-security.test.js`.
- [x] Local data remains fully available and functional signed out.
- [x] Cloud errors (`CloudUnavailableError`, `CloudSyncError`) are
  caught at the UI layer and never touch/corrupt local IndexedDB data.
- [x] The Supabase JS CDN dependency is pinned to an exact version, not
  a floating major-version alias (see §8).

**Verifying RLS and the tenant-scoped foreign keys** requires a real
Postgres engine (both are enforced by Postgres itself, not by any JS in
this repo, so neither can be exercised against the in-memory fake
client the rest of the test suite uses). Three ways to check them,
in order of how close each gets to the real, deployed thing:

### 7.1 Automated, against a real Supabase project

`tests/integration/cloud-rls.integration.test.js`:
1. Apply `supabase/schema.sql` to a disposable/dev project.
2. Create two test accounts in that project (Authentication → Users →
   Add user, or sign up through the app once).
3. Run:
   ```
   SUPABASE_TEST_URL=https://xxxx.supabase.co \
   SUPABASE_TEST_ANON_KEY=your-anon-key \
   SUPABASE_TEST_USER_A_EMAIL=a@test.com SUPABASE_TEST_USER_A_PASSWORD=... \
   SUPABASE_TEST_USER_B_EMAIL=b@test.com SUPABASE_TEST_USER_B_PASSWORD=... \
   npm run test:cloud-integration
   ```
   Without those env vars, this suite reports every test as **skipped**
   (not failed/passed) — it never runs against fake data, and it's
   never part of plain `npm test`. It covers: A can access their own
   records; B cannot SELECT/UPDATE/DELETE A's records; B cannot INSERT
   a row claiming to be A's; and B cannot construct a workout, set, or
   calendar entry that references A's session/workout/exercise, even
   though the row genuinely belongs to B (this last group is what the
   composite FKs, not RLS, reject).

### 7.2 Manual, against a real Supabase project

Sign in as two different accounts (two browser profiles, or one
browser + one incognito window) against the same project, back up
different data from each, and confirm neither account's More screen
ever shows the other's data after Restore.

### 7.3 Local, no Supabase project needed

`supabase/local-verification.sql` runs the real `schema.sql` against a
disposable local Postgres 15+ with a minimal stand-in for Supabase's
`auth.users`/`auth.uid()`/roles, then directly exercises both the
composite FKs and the RLS policies with plain SQL, printing an
"expect ..." line before each check so the output is easy to read.
This is what was used to verify this hardening pass itself (Postgres
16, installed fresh for the purpose) — every FK rejection, every RLS
isolation case (SELECT/UPDATE/DELETE/INSERT-spoof), the `anon`-role
no-session case, and running `schema.sql` three times in a row to
confirm it stays idempotent were all checked this way and passed. It
is not a substitute for §7.1 (it doesn't touch real PostgREST/GoTrue),
but it catches a real schema bug in seconds, with no credentials —
this is in fact how one was caught while writing this pass: the first
draft dropped each parent's `UNIQUE(user_id, id)` constraint before
dropping the child FKs that depend on it, which is exactly backwards
and fails with "cannot drop constraint ... because other objects
depend on it" the moment the script is run a second time. §3's
two-phase drop order is the fix.

## 8. Supabase JS version pinning

The CDN `<script>` tag in `index.html` is pinned to an **exact**
version of `@supabase/supabase-js` (currently `2.117.2`), not a
floating `@2` major-version alias. A `<script src>` has no lockfile of
its own the way `package.json`/`package-lock.json` pins the Node-side
integration-test dependency — the URL itself is the only pin available,
so for a dependency this central to auth and data access, floating on
"whatever the latest 2.x happens to be today" would mean any new
supabase-js release could silently change behavior for every user of
this app, with no review step. Bump the version deliberately (test
sign-in/backup/restore against the new version first) rather than
switching back to a floating alias.

## 9. Known limitations

- **No true field-level conflict resolution.** Restoring (even in
  "merge" mode) overwrites a local record that shares an ID with a
  cloud one — there's no per-field diff or newest-wins comparison yet.
  This is fine for this phase's "explicit, occasional backup/restore"
  scope, but would need addressing before any automatic/background
  sync (see §6).
- **Session exercises/prescriptions are embedded jsonb, not a separate
  table.** This mirrors the local data model exactly (they're an array
  field on the Session record, not their own IndexedDB store) —
  intentional, not an oversight; see `supabase/schema.sql`'s comments.
- **Email confirmation UX is minimal.** If a Supabase project requires
  email confirmation, sign-up just says "check your email" — there's
  no resend-confirmation button or deep-link handling in this phase.
