const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp } = require('./helpers/domSetup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

async function makeWorkoutWithNote(App, note) {
  const w = await App.commands.startWorkout('Push', []);
  await App.commands.editWorkoutMeta(w.id, { notes: note });
  await App.commands.finishWorkout(w.id);
  return w.id;
}

test('Notes: JSON export -> replace import preserves workout notes', async () => {
  const { App } = await bootRealApp();
  const id = await makeWorkoutWithNote(App, 'Tell my coach: knees hurt.');
  const data = JSON.parse(JSON.stringify(await App.db.exportAll()));
  await App.db.clearAll();
  await App.db.importAll(data, 'replace');
  assert.equal((await App.queries.getWorkout(id)).notes, 'Tell my coach: knees hurt.');
});

test('Notes: cloud backup -> restore preserves workout notes', async () => {
  const { App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ initialUser: { id: 'user-1', email: 'sam@example.com' } });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();

  const id = await makeWorkoutWithNote(App, 'Felt strong.');
  await App.cloud.backup.backupAll();
  assert.equal(client._tables.workouts.get(id).notes, 'Felt strong.');

  await App.db.clearAll();
  await App.cloud.restore.restoreAll('replace');
  assert.equal((await App.queries.getWorkout(id)).notes, 'Felt strong.');
});
