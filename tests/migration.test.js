const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIndexedDB = require('fake-indexeddb');
const { IDBFactory, IDBKeyRange } = fakeIndexedDB;

function buildV1Database(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open('fitlog', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore('settings', { keyPath: 'id' });
      const ex = db.createObjectStore('exercises', { keyPath: 'id' });
      ex.createIndex('name', 'name');
      const w = db.createObjectStore('workouts', { keyPath: 'id' });
      w.createIndex('date', 'date');
      const s = db.createObjectStore('sets', { keyPath: 'id' });
      s.createIndex('workoutId', 'workoutId');
      s.createIndex('exerciseId', 'exerciseId');
      db.createObjectStore('templates', { keyPath: 'id' });
      db.createObjectStore('bodyweightLogs', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('nutritionLogs', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('sleepLogs', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('measurements', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('date', 'date');
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

test('v1 -> v2 upgrade backfills workoutExercises and patches old sets', async () => {
  const factory = new IDBFactory();
  const db1 = await buildV1Database(factory);

  // Seed a v1-shaped completed workout: bare exerciseOrder array, sets
  // referencing exerciseId directly, no status field, completedAt always set.
  const exerciseId = 'ex-bench';
  const workoutId = 'w-old';
  await new Promise((resolve, reject) => {
    const tx = db1.transaction(['exercises', 'workouts', 'sets'], 'readwrite');
    tx.objectStore('exercises').add({ id: exerciseId, name: 'Bench Press', archived: false });
    tx.objectStore('workouts').add({
      id: workoutId, date: '2025-01-01', title: 'Old Upper', exerciseOrder: [exerciseId],
      startedAt: '2025-01-01T10:00:00.000Z', endedAt: '2025-01-01T10:40:00.000Z',
      createdAt: '2025-01-01T10:00:00.000Z', updatedAt: '2025-01-01T10:40:00.000Z'
    });
    tx.objectStore('sets').add({
      id: 'set-old', workoutId, exerciseId, setIndex: 0, weight: 115, reps: 8,
      completedAt: '2025-01-01T10:05:00.000Z'
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db1.close();

  // Point the real app source at the SAME factory and open at v2 — this
  // exercises the actual onupgradeneeded migration path in js/db.js.
  global.window = global;
  global.indexedDB = factory;
  global.IDBKeyRange = IDBKeyRange;
  global.App = {};
  global.window.App = global.App;
  for (const rel of ['../js/utils.js', '../js/db.js', '../js/queries.js', '../js/commands.js', '../js/analytics.js']) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }

  const migratedWorkout = await App.queries.getWorkout(workoutId);
  assert.equal(migratedWorkout.status, 'completed', 'status should be backfilled from endedAt');

  const workoutExercises = await App.queries.getWorkoutExercises(workoutId);
  assert.equal(workoutExercises.length, 1);
  assert.equal(workoutExercises[0].exerciseId, exerciseId);

  const sets = await App.queries.getSetsForWorkoutExercise(workoutExercises[0].id);
  assert.equal(sets.length, 1, 'the old set should now be linked via workoutExerciseId');
  assert.equal(sets[0].id, 'set-old');
  assert.equal(sets[0].weight, 115);

  // And the domain layer built on top of the migrated data works normally.
  const history = await App.queries.getExerciseHistory(exerciseId);
  assert.equal(history.length, 1);
  assert.equal(App.analytics.bestRecordedSet(history[0].sets).weight, 115);
});
