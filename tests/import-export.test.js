const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

async function seedSomeData(App) {
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Upper', exerciseIds: [bench.id] });
  const set = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(set.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);
  await App.commands.setBodyweight(175.4);
  return { bench, workout };
}

test('export -> clear -> import (replace) round trip preserves every record', async () => {
  const App = freshApp();
  await seedSomeData(App);

  const exported = await App.db.exportAll();
  assert.equal(exported.meta.formatVersion, App.db.FORMAT_VERSION);

  const before = {};
  for (const store of App.db.STORES) before[store] = (await App.db.getAll(store)).length;

  await App.db.clearAll();
  await App.db.importAll(exported, 'replace');

  for (const store of App.db.STORES) {
    assert.equal((await App.db.getAll(store)).length, before[store], `store "${store}" mismatch after round trip`);
  }
});

test('a malformed import is rejected and existing data is untouched', async () => {
  const App = freshApp();
  await seedSomeData(App);
  const before = (await App.db.getAll('workouts')).length;

  const malformed = { meta: { formatVersion: 1 }, stores: { workouts: [{ id: 'bad' }] } };
  await assert.rejects(() => App.db.importAll(malformed, 'replace'));

  assert.equal((await App.db.getAll('workouts')).length, before);
});

test('import with a newer formatVersion than supported is rejected', async () => {
  const App = freshApp();
  const future = { meta: { formatVersion: App.db.FORMAT_VERSION + 1 }, stores: { exercises: [] } };
  await assert.rejects(() => App.db.importAll(future, 'merge'));
});

test('merge import adds records without deleting what already exists', async () => {
  const App = freshApp();
  const { bench } = await seedSomeData(App);

  await App.db.importAll({
    meta: { formatVersion: App.db.FORMAT_VERSION },
    stores: { exercises: [{ id: 'ex-extra', name: 'Overhead Press', archived: false }] }
  }, 'merge');

  const exercises = await App.db.getAll('exercises');
  assert.ok(exercises.find(e => e.id === bench.id));
  assert.ok(exercises.find(e => e.id === 'ex-extra'));
});
