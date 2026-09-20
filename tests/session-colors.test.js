const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, reopenApp } = require('./helpers/setup');

test('6. Session color persists', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  assert.equal(session.color, 'red');
  const reloaded = await App.queries.getSession(session.id);
  assert.equal(reloaded.color, 'red');
});

test('7. A Session created without a color receives the default', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', []);
  assert.equal(session.color, App.sessionColors.DEFAULT_COLOR);
});

test('an invalid/unknown color falls back to the default rather than being stored as-is', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'not-a-real-color');
  assert.equal(session.color, App.sessionColors.DEFAULT_COLOR);
});

test('updateSession normalizes an invalid color the same way createSession does', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'blue');
  const updated = await App.commands.updateSession(session.id, { color: 'nonsense' });
  assert.equal(updated.color, App.sessionColors.DEFAULT_COLOR);
});

test('changing a Session color does not rewrite historical workouts', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const workout = await App.commands.startFromSession(session);
  await App.commands.finishWorkout(workout.id);

  await App.commands.updateSession(session.id, { color: 'blue' });

  // The workout itself never stored a duplicate color — it only has a
  // sessionId, so it automatically reflects the session's CURRENT color
  // wherever it's displayed, with nothing to "rewrite".
  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.equal(reloadedWorkout.sessionId, session.id);
  assert.equal((await App.queries.getSession(session.id)).color, 'blue');
});

test('a pre-existing session without a color is backfilled with a default during the v1->v2 migration', async () => {
  const fakeIndexedDB = require('fake-indexeddb');
  const { IDBFactory } = fakeIndexedDB;
  const factory = new IDBFactory();

  // Build a v1-shaped database directly (no color field existed then).
  await new Promise((resolve, reject) => {
    const req = factory.open('fitlog_v2', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore('exercises', { keyPath: 'id' }).createIndex('name', 'name');
      db.createObjectStore('sessions', { keyPath: 'id' });
      const w = db.createObjectStore('workouts', { keyPath: 'id' });
      w.createIndex('date', 'date');
      w.createIndex('status', 'status');
      const s = db.createObjectStore('sets', { keyPath: 'id' });
      s.createIndex('workoutId', 'workoutId');
      s.createIndex('exerciseId', 'exerciseId');
      db.createObjectStore('calendarEntries', { keyPath: 'id' }).createIndex('date', 'date');
      db.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  }).then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions'], 'readwrite');
    tx.objectStore('sessions').add({ id: 'old-session', name: 'Legacy Upper', exercises: [] });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  }));

  // Now open the real app source against this same factory at v2.
  global.window = global;
  global.indexedDB = factory;
  global.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
  global.App = {};
  global.window.App = global.App;
  for (const rel of ['../js/utils.js', '../js/errors.js', '../js/sessionColors.js', '../js/prescriptions.js', '../js/db.js', '../js/queries.js', '../js/commands.js', '../js/analytics.js']) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }

  const migrated = await App.queries.getSession('old-session');
  assert.equal(migrated.color, 'gray', 'pre-color-feature session should be backfilled to the default');
});
