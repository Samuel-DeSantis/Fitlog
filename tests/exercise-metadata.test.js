const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('a freshly seeded install has metadata on every default exercise', async () => {
  const App = freshApp();
  await App.ensureSeed();
  const bench = (await App.queries.getExercises()).find(e => e.name === 'Bench Press');
  assert.deepEqual(bench.primaryMuscles, ['chest']);
  assert.deepEqual(bench.secondaryMuscles, ['triceps', 'shoulders']);
  assert.equal(bench.equipment, 'barbell');
  assert.equal(bench.movementType, 'horizontal_push');
});

test('createExercise defaults to empty metadata when none is given (custom user exercises)', async () => {
  const App = freshApp();
  const ex = await App.commands.createExercise('My Custom Move');
  assert.deepEqual(ex.primaryMuscles, []);
  assert.deepEqual(ex.secondaryMuscles, []);
  assert.equal(ex.equipment, '');
  assert.equal(ex.movementType, '');
});

test('getRecentlyUsedExerciseIds orders by most-recent-workout-first, deduped, respecting the limit', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const squat = await App.commands.createExercise('Squat');

  const w1 = await App.commands.createWorkout({ date: App.utils.daysAgoISO(5), exerciseIds: [bench.id, row.id] });
  await App.commands.finishWorkout(w1.id);
  const w2 = await App.commands.createWorkout({ date: App.utils.daysAgoISO(1), exerciseIds: [squat.id, bench.id] });
  await App.commands.finishWorkout(w2.id);

  const recent = await App.queries.getRecentlyUsedExerciseIds(8);
  assert.deepEqual(recent, [squat.id, bench.id, row.id]);
});

test('getRecentlyUsedExerciseIds respects the limit', async () => {
  const App = freshApp();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await App.commands.createExercise('Ex ' + i)).id);
  const w = await App.commands.createWorkout({ exerciseIds: ids });
  await App.commands.finishWorkout(w.id);

  const recent = await App.queries.getRecentlyUsedExerciseIds(3);
  assert.equal(recent.length, 3);
  assert.deepEqual(recent, ids.slice(0, 3));
});

test('archived exercises are excluded from the default (picker) exercise list', async () => {
  const App = freshApp();
  const ex = await App.commands.createExercise('Old Move');
  await App.commands.archiveExercise(ex.id);

  const active = await App.queries.getExercises();
  assert.equal(active.find(e => e.id === ex.id), undefined);

  const all = await App.queries.getExercises(true);
  assert.ok(all.find(e => e.id === ex.id), 'archived exercise still exists for historical reference');
});

test('MIGRATION v2 -> v3: existing exercises get metadata backfilled by name, IDs and other stores untouched', async () => {
  const fakeIndexedDB = require('fake-indexeddb');
  const { IDBFactory } = fakeIndexedDB;
  const factory = new IDBFactory();

  const db = await new Promise((resolve, reject) => {
    const req = factory.open('fitlog_v2', 2);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      database.createObjectStore('exercises', { keyPath: 'id' }).createIndex('name', 'name');
      database.createObjectStore('sessions', { keyPath: 'id' });
      const w = database.createObjectStore('workouts', { keyPath: 'id' });
      w.createIndex('date', 'date');
      w.createIndex('status', 'status');
      const s = database.createObjectStore('sets', { keyPath: 'id' });
      s.createIndex('workoutId', 'workoutId');
      s.createIndex('exerciseId', 'exerciseId');
      database.createObjectStore('calendarEntries', { keyPath: 'id' }).createIndex('date', 'date');
      database.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });

  const knownId = 'ex-bench-legacy';
  const customId = 'ex-custom-legacy';
  const workoutId = 'w-legacy';
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['exercises', 'workouts', 'sets'], 'readwrite');
    tx.objectStore('exercises').add({ id: knownId, name: 'Bench Press', archived: false });
    tx.objectStore('exercises').add({ id: customId, name: 'My Weird Custom Exercise', archived: false });
    tx.objectStore('workouts').add({ id: workoutId, date: '2026-01-01', status: 'completed', exerciseOrder: [knownId], startedAt: '', endedAt: '', createdAt: '', updatedAt: '' });
    tx.objectStore('sets').add({ id: 'set-legacy', workoutId, exerciseId: knownId, setOrder: 0, weight: 135, reps: 8, completedAt: '2026-01-01T00:00:00.000Z' });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });

  global.window = global;
  global.indexedDB = factory;
  global.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
  global.App = {};
  global.window.App = global.App;
  for (const rel of ['../js/utils.js', '../js/errors.js', '../js/sessionColors.js', '../js/prescriptions.js', '../js/exerciseMetadata.js', '../js/muscleGroups.js', '../js/db.js', '../js/queries.js', '../js/commands.js', '../js/analytics.js']) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }

  const migratedBench = await App.db.get('exercises', knownId);
  assert.equal(migratedBench.id, knownId, 'exercise ID must be preserved by the migration');
  assert.deepEqual(migratedBench.primaryMuscles, ['chest'], 'known exercise backfilled by name match');
  assert.deepEqual(migratedBench.secondaryMuscles, ['triceps', 'shoulders']);
  assert.equal(migratedBench.equipment, 'barbell');
  assert.equal(migratedBench.movementType, 'horizontal_push');

  const migratedCustom = await App.db.get('exercises', customId);
  assert.equal(migratedCustom.id, customId);
  assert.deepEqual(migratedCustom.primaryMuscles, [], 'unrecognized custom exercise gets empty defaults, not a guess');
  assert.deepEqual(migratedCustom.secondaryMuscles, []);

  const workout = await App.db.get('workouts', workoutId);
  assert.equal(workout.status, 'completed');
  assert.deepEqual(workout.exerciseOrder, [knownId]);
  const set = await App.db.get('sets', 'set-legacy');
  assert.equal(set.weight, 135);
  assert.equal(set.exerciseId, knownId, 'the set still references the same exercise ID after migration');
});
