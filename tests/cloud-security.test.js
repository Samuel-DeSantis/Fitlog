// IMPORTANT SCOPE NOTE: Row Level Security itself (the actual
// enforcement that one authenticated user cannot read/write another
// user's rows) lives in Postgres, inside a real Supabase project — it
// cannot be exercised against a fake in-memory client, because the fake
// client has no policy engine to bypass or enforce in the first place.
// That is covered instead by:
//   - supabase/schema.sql (the policies themselves, using auth.uid())
//   - tests/integration/cloud-rls.integration.test.js (a real-project
//     test, skipped unless real credentials are supplied — see
//     docs/cloud-setup.md)
//
// What CAN be tested here, with no real project, is the client-side
// half of "do not trust a user_id supplied by the client": that
// FitLog's own backup code never reads an ownership field off the
// local record, and always stamps the row with whoever is actually
// authenticated right now. This is defense in depth, not the real
// security boundary — RLS is — but it is a real property of this
// codebase worth locking in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

const REAL_USER = { id: 'real-user-1', email: 'real@example.com' };

async function signedInApp() {
  const App = freshApp();
  const client = makeFakeSupabaseClient({ initialUser: REAL_USER });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();
  return { App, client };
}

test('every backup row mapper stamps user_id from the argument, ignoring any userId-shaped field already on the record', async () => {
  const { App } = await signedInApp();
  const spoofed = { userId: 'attacker', user_id: 'attacker' };

  const exercise = { id: 'ex-1', name: 'Bench Press', ...spoofed };
  const session = { id: 'sess-1', name: 'Upper', exercises: [], ...spoofed };
  const workout = { id: 'wk-1', title: 'Upper', date: '2026-01-01', status: 'completed', ...spoofed };
  const set = { id: 'set-1', workoutId: 'wk-1', exerciseId: 'ex-1', setOrder: 0, ...spoofed };
  const entry = { id: 'ce-1', date: '2026-01-01', ...spoofed };

  assert.equal(App.cloud.backup.exerciseToRow(exercise, REAL_USER.id).user_id, REAL_USER.id);
  assert.equal(App.cloud.backup.sessionToRow(session, REAL_USER.id).user_id, REAL_USER.id);
  assert.equal(App.cloud.backup.workoutToRow(workout, REAL_USER.id).user_id, REAL_USER.id);
  assert.equal(App.cloud.backup.setToRow(set, REAL_USER.id).user_id, REAL_USER.id);
  assert.equal(App.cloud.backup.calendarEntryToRow(entry, REAL_USER.id).user_id, REAL_USER.id);
});

test('backupAll always uses App.cloud.auth.getUser().id for every row, never a value from the exported data', async () => {
  const { App, client } = await signedInApp();
  await App.commands.createExercise('Bench Press');

  await App.cloud.backup.backupAll();

  const rows = [...client._tables.exercises.values()];
  assert.ok(rows.length > 0);
  rows.forEach(row => assert.equal(row.user_id, REAL_USER.id));
});

test('restore only ever fetches rows already filtered to the signed-in user (eq("user_id", currentUser.id))', async () => {
  const { App, client } = await signedInApp();

  // Seed rows for BOTH the real user and a completely different user in
  // the same fake cloud table, mimicking what two isolated tenants
  // would look like inside one Supabase project.
  client._tables.exercises.set('mine', {
    id: 'mine', user_id: REAL_USER.id, name: 'Mine', primary_muscles: [], secondary_muscles: [], equipment: '', movement_type: '', archived: false
  });
  client._tables.exercises.set('theirs', {
    id: 'theirs', user_id: 'someone-else', name: 'Not Mine', primary_muscles: [], secondary_muscles: [], equipment: '', movement_type: '', archived: false
  });

  const snapshot = await App.cloud.restore.fetchCloudSnapshot();
  const ids = snapshot.stores.exercises.map(e => e.id);

  assert.ok(ids.includes('mine'));
  assert.ok(!ids.includes('theirs'), 'restore must never pull another user\'s rows into this device');
});
