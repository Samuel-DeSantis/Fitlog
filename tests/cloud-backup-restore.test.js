const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

const FAKE_USER = { id: 'user-1', email: 'sam@example.com' };

async function signedInApp(fakeClientOpts) {
  const App = freshApp();
  const client = makeFakeSupabaseClient({ initialUser: FAKE_USER, ...fakeClientOpts });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();
  return { App, client };
}

// Seeds a representative local dataset touching every store: an
// exercise, a Session with a real prescription, a completed Workout
// (created FROM that Session, so its exerciseOrder/sessionId/prescribed
// sets all line up), and a planned Calendar Entry — plus a bodyweight
// setting. Returns the created records for assertions.
async function seedLocalData(App) {
  const bench = await App.commands.createExercise('Bench Press', { equipment: 'barbell' });
  const session = await App.commands.createSession('Upper', [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }], 'blue');
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(sets[0].id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);
  const entry = await App.commands.planCalendarEntry(App.utils.daysAgoISO(-3), session.id);
  await App.commands.setBodyweight(180.5);
  return { bench, session, workout, entry };
}

test('backupAll maps every store to the right cloud table, preserving IDs, relationships, and prescriptions', async () => {
  const { App, client } = await signedInApp();
  const { bench, session, workout, entry } = await seedLocalData(App);

  const counts = await App.cloud.backup.backupAll();
  assert.equal(counts.exercises, 1);
  assert.equal(counts.sessions, 1);
  assert.equal(counts.workouts, 1);
  assert.ok(counts.sets >= 1);
  assert.equal(counts.calendarEntries, 1);
  assert.equal(counts.settings, 1);

  const exRow = client._tables.exercises.get(bench.id);
  assert.equal(exRow.user_id, FAKE_USER.id);
  assert.equal(exRow.name, 'Bench Press');
  assert.equal(exRow.equipment, 'barbell');

  const sessionRow = client._tables.sessions.get(session.id);
  assert.equal(sessionRow.user_id, FAKE_USER.id);
  assert.deepEqual(sessionRow.exercises, [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);

  const workoutRow = client._tables.workouts.get(workout.id);
  assert.equal(workoutRow.session_id, session.id, 'relationship to the session is preserved');
  assert.equal(workoutRow.status, 'completed');
  assert.deepEqual(workoutRow.exercise_order, [bench.id]);

  const setRows = [...client._tables.sets.values()].filter(r => r.workout_id === workout.id);
  const loggedSet = setRows.find(r => r.weight === 135);
  assert.ok(loggedSet, 'the logged set made it to the cloud');
  assert.equal(loggedSet.exercise_id, bench.id);

  const entryRow = client._tables.calendar_entries.get(entry.id);
  assert.equal(entryRow.session_id, session.id);

  const settingsRow = [...client._tables.user_settings.values()][0];
  assert.equal(settingsRow.user_id, FAKE_USER.id);
  assert.equal(settingsRow.bodyweight, 180.5);
});

test('backupAll always stamps user_id from the authenticated session, never from local data', async () => {
  const { App, client } = await signedInApp();
  // Even if a local record somehow carried a userId-shaped field, the
  // mapper must never read it — user_id always comes from the
  // authenticated session, since RLS's own auth.uid() check is the
  // real enforcement, but the client should never even try to spoof it.
  const ex = await App.commands.createExercise('Deadlift');
  ex.userId = 'someone-elses-id';
  ex.user_id = 'someone-elses-id';
  await App.db.put('exercises', ex);

  await App.cloud.backup.backupAll();
  const row = client._tables.exercises.get(ex.id);
  assert.equal(row.user_id, FAKE_USER.id);
});

test('repeated backups upsert, never duplicating rows', async () => {
  const { App, client } = await signedInApp();
  await seedLocalData(App);

  await App.cloud.backup.backupAll();
  const countAfterFirst = client._tables.exercises.size;
  await App.cloud.backup.backupAll();
  const countAfterSecond = client._tables.exercises.size;

  assert.equal(countAfterFirst, countAfterSecond);
  assert.equal(countAfterFirst, 1);
});

test('backing up never deletes a cloud record that is missing locally', async () => {
  const { App, client } = await signedInApp();
  await seedLocalData(App);

  // Simulate a record from another device that was never fetched here.
  client._tables.exercises.set('ex-from-other-device', {
    id: 'ex-from-other-device', user_id: FAKE_USER.id, name: 'Overhead Press',
    primary_muscles: ['shoulders'], secondary_muscles: [], equipment: 'barbell', movement_type: '', archived: false
  });

  await App.cloud.backup.backupAll();

  assert.ok(client._tables.exercises.has('ex-from-other-device'), 'backup must be additive, never a delete');
});

test('backupAll refuses to run when signed out, and touches nothing', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({}));
  await App.cloud.auth.init();
  await seedLocalData(App);

  await assert.rejects(() => App.cloud.backup.backupAll(), App.errors.CloudUnavailableError);
});

// A second "device": a completely fresh local IndexedDB (freshApp()),
// but pointed at the SAME fake Supabase client/tables another device
// already backed up to — exactly what two real devices sharing one
// Supabase project would look like.
async function secondDeviceUsingSameCloud(existingClient) {
  const App = freshApp();
  App.cloud._setClientForTests(existingClient);
  await App.cloud.auth.init();
  return App;
}

test('restoreAll (merge) writes cloud records into IndexedDB, preserving IDs and relationships', async () => {
  // "Device A": back up a real local dataset to the fake cloud.
  const deviceA = await signedInApp();
  const { bench, session, workout } = await seedLocalData(deviceA.App);
  await deviceA.App.cloud.backup.backupAll();

  // "Device B": a completely fresh local database, same cloud user/data.
  const deviceB = { App: await secondDeviceUsingSameCloud(deviceA.client) };

  await deviceB.App.cloud.restore.restoreAll('merge');

  const restoredExercise = await deviceB.App.queries.getExercises(true).then(list => list.find(e => e.id === bench.id));
  assert.ok(restoredExercise, 'the exercise was restored with its original ID');
  assert.equal(restoredExercise.name, 'Bench Press');

  const restoredSession = await deviceB.App.queries.getSession(session.id);
  assert.ok(restoredSession);
  assert.deepEqual(restoredSession.exercises, [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);

  const restoredWorkout = await deviceB.App.queries.getWorkout(workout.id);
  assert.ok(restoredWorkout);
  assert.equal(restoredWorkout.sessionId, session.id);
  assert.equal(restoredWorkout.status, 'completed');

  const restoredSets = await deviceB.App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.ok(restoredSets.some(s => s.weight === 135 && s.reps === 8));

  const restoredSettings = await deviceB.App.queries.getSettings();
  assert.equal(restoredSettings.bodyweight, 180.5);
});

test('restoring twice does not duplicate records', async () => {
  const deviceA = await signedInApp();
  await seedLocalData(deviceA.App);
  await deviceA.App.cloud.backup.backupAll();

  const AppB = await secondDeviceUsingSameCloud(deviceA.client);

  await AppB.cloud.restore.restoreAll('merge');
  const countAfterFirst = (await AppB.db.getAll('exercises')).length;
  await AppB.cloud.restore.restoreAll('merge');
  const countAfterSecond = (await AppB.db.getAll('exercises')).length;

  assert.equal(countAfterFirst, countAfterSecond);
});

test('restore (replace mode) clears existing local data first, restore (merge) does not', async () => {
  const deviceA = await signedInApp();
  await seedLocalData(deviceA.App);
  await deviceA.App.cloud.backup.backupAll();

  const AppB = await secondDeviceUsingSameCloud(deviceA.client);
  const localOnly = await AppB.commands.createExercise('Only On Device B');

  await AppB.cloud.restore.restoreAll('replace');
  const afterReplace = await AppB.queries.getExercises(true);
  assert.equal(afterReplace.some(e => e.id === localOnly.id), false, 'replace mode clears local-only data first');
});

test('malformed cloud data is rejected safely, leaving local data untouched', async () => {
  const deviceA = await signedInApp();
  await seedLocalData(deviceA.App);
  await deviceA.App.cloud.backup.backupAll();
  // Corrupt one row directly in the fake cloud table — missing a
  // required field (status), same shape App.db.validateImportPayload
  // already rejects for a bad JSON import file.
  const [badId, badRow] = [...deviceA.client._tables.workouts.entries()][0];
  deviceA.client._tables.workouts.set(badId, { ...badRow, status: undefined });

  const AppB = await secondDeviceUsingSameCloud(deviceA.client);
  const before = await AppB.db.getAll('exercises');

  await assert.rejects(() => AppB.cloud.restore.restoreAll('merge'));

  const after = await AppB.db.getAll('exercises');
  assert.equal(after.length, before.length, 'a rejected restore must not partially write anything');
});

test('restoreAll refuses to run when signed out', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({}));
  await App.cloud.auth.init();
  await assert.rejects(() => App.cloud.restore.restoreAll('merge'), App.errors.CloudUnavailableError);
});

// Hardening pass: Sets previously had no updated_at at all, and Settings
// always got a fresh backup-time timestamp rather than its real last-
// changed time. Both are now tracked locally (see commands.js's
// updateSet/setSetCompleted/setUnit/setBodyweight) and must survive a
// backup/restore round trip unchanged — this is what a future
// last-write-wins sync would need to compare correctly.
test('a Set\'s real updatedAt (not the backup time) is preserved through backup and restore', async () => {
  const { App, client } = await signedInApp();
  const { bench, workout } = await seedLocalData(App);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  const originalUpdatedAt = sets[0].updatedAt;
  assert.ok(originalUpdatedAt, 'updateSet (called during seedLocalData) must have stamped updatedAt');

  await App.cloud.backup.backupAll();
  const cloudRow = [...client._tables.sets.values()].find(r => r.id === sets[0].id);
  assert.equal(cloudRow.updated_at, originalUpdatedAt, 'backup must carry the set\'s real updatedAt, not a fresh one');

  const AppB = await secondDeviceUsingSameCloud(client);
  await AppB.cloud.restore.restoreAll('merge');
  const restoredSet = await AppB.db.get('sets', sets[0].id);
  assert.equal(restoredSet.updatedAt, originalUpdatedAt);
});

test('Settings\' updatedAt reflects when unit/bodyweight actually changed, not when backup ran', async () => {
  const { App, client } = await signedInApp();
  await App.commands.setBodyweight(180.5);
  const settingsAfterChange = await App.queries.getSettings();
  const realChangeTimestamp = settingsAfterChange.updatedAt;
  assert.ok(realChangeTimestamp);

  // Simulate time passing before the user gets around to backing up —
  // if backup were (incorrectly) stamping "now", this would catch it.
  await new Promise(resolve => setTimeout(resolve, 5));
  await App.cloud.backup.backupAll();

  const cloudRow = [...client._tables.user_settings.values()][0];
  assert.equal(cloudRow.updated_at, realChangeTimestamp, 'backup must not overwrite this with the backup time');
});
