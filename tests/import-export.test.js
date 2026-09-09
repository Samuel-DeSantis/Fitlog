const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

async function seedSomeData(App) {
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);
  const [we] = await App.queries.getWorkoutExercises(workout.id);
  const set = await App.commands.addEmptySet(we);
  await App.commands.updateSet(set.id, { weight: 115, reps: 8 });
  await App.commands.finishWorkout(workout.id);
  await App.commands.addBodyweight(App.utils.todayLocalISO(), 175.4);
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
  for (const store of App.db.STORES) assert.equal((await App.db.getAll(store)).length, 0);

  await App.db.importAll(exported, 'replace');

  for (const store of App.db.STORES) {
    const count = (await App.db.getAll(store)).length;
    assert.equal(count, before[store], `store "${store}" should have the same record count after round trip`);
  }
});

test('a malformed import is rejected and existing data is left untouched', async () => {
  const App = freshApp();
  await seedSomeData(App);
  const before = (await App.db.getAll('workouts')).length;

  const malformed = {
    meta: { formatVersion: 2 },
    stores: {
      workouts: [{ id: 'w-bad' /* missing required date/status */ }]
    }
  };

  await assert.rejects(() => App.db.importAll(malformed, 'replace'));

  const after = (await App.db.getAll('workouts')).length;
  assert.equal(after, before, 'existing workouts must survive a rejected import');
});

test('import with a newer formatVersion than supported is rejected', async () => {
  const App = freshApp();
  const future = { meta: { formatVersion: App.db.FORMAT_VERSION + 1 }, stores: { exercises: [] } };
  await assert.rejects(() => App.db.importAll(future, 'merge'));
});

test('merge import adds records without deleting what already exists', async () => {
  const App = freshApp();
  const { bench } = await seedSomeData(App);

  const extraExercise = { id: 'ex-extra', name: 'Overhead Press', category: 'Shoulders', archived: false };
  await App.db.importAll({
    meta: { formatVersion: App.db.FORMAT_VERSION },
    stores: { exercises: [extraExercise] }
  }, 'merge');

  const exercises = await App.db.getAll('exercises');
  assert.ok(exercises.find(e => e.id === bench.id), 'original data survives a merge');
  assert.ok(exercises.find(e => e.id === 'ex-extra'), 'new data is added by a merge');
});
