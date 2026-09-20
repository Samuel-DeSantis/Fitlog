const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, reopenApp } = require('./helpers/setup');

// ---------------------------------------------------------------------
// 1 & 2. A Session can store prescription information, and it survives
// save/reload.
// ---------------------------------------------------------------------

test('a Session can store a prescription (targetSets/repMin/repMax) per exercise', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');

  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    row.id // still fine to mix in a bare ID with no prescription yet
  ]);

  assert.deepEqual(session.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(session.exercises[1], { exerciseId: row.id, targetSets: null, repMin: null, repMax: null });
});

test('prescription fields survive save/reload (a simulated app restart)', async () => {
  let App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  App = reopenApp();
  const reloaded = await App.queries.getSession(session.id);
  assert.deepEqual(reloaded.exercises, [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
});

test('updateSessionExercisePrescription sets/updates one exercise\'s prescription without touching others', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [bench.id, row.id]);

  const updated = await App.commands.updateSessionExercisePrescription(session.id, bench.id, {
    targetSets: 3, repMin: 5, repMax: 8
  });
  assert.deepEqual(updated.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(updated.exercises[1], { exerciseId: row.id, targetSets: null, repMin: null, repMax: null }, "the other exercise's (lack of) prescription is untouched");

  // A partial update only changes the fields given; the rest carry over.
  const partial = await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 4 });
  assert.deepEqual(partial.exercises[0], { exerciseId: bench.id, targetSets: 4, repMin: 5, repMax: 8 });

  // Passing nulls clears a prescription back out.
  const cleared = await App.commands.updateSessionExercisePrescription(session.id, bench.id, {
    targetSets: null, repMin: null, repMax: null
  });
  assert.deepEqual(cleared.exercises[0], { exerciseId: bench.id, targetSets: null, repMin: null, repMax: null });
});

test('updateSessionExercisePrescription rejects an exerciseId that is not part of the session', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const curl = await App.commands.createExercise('Barbell Curl');
  const session = await App.commands.createSession('Upper Strength', [bench.id]);

  await assert.rejects(
    () => App.commands.updateSessionExercisePrescription(session.id, curl.id, { targetSets: 3 }),
    /not part of this session/
  );
});

// ---------------------------------------------------------------------
// 6. Invalid prescription values are rejected (the app's existing
// convention: reject explicitly rather than silently repairing — see
// errors.js and db.js's import validation).
// ---------------------------------------------------------------------

test('invalid prescription values are rejected rather than silently normalized', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  await assert.rejects(
    () => App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 0, repMin: 5, repMax: 8 }]),
    /targetSets must be a positive integer/
  );
  await assert.rejects(
    () => App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 3.5, repMin: 5, repMax: 8 }]),
    /targetSets must be a positive integer/
  );
  await assert.rejects(
    () => App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 3, repMin: -1, repMax: 8 }]),
    /repMin must be a positive integer/
  );
  await assert.rejects(
    () => App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 3, repMin: 8, repMax: 5 }]),
    /repMax must be greater than or equal to repMin/
  );
  await assert.rejects(
    () => App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 3, repMin: '5', repMax: 8 }]),
    /repMin must be a positive integer/,
    'a numeric-looking string is not a number'
  );

  // A session with no prescription data at all, or only some fields set,
  // remains perfectly valid — only actually-invalid values are rejected.
  const session = await App.commands.createSession('X', [bench.id]);
  assert.deepEqual(session.exercises[0], { exerciseId: bench.id, targetSets: null, repMin: null, repMax: null });

  const withPartial = await App.commands.updateSession(session.id, {
    exercises: [{ exerciseId: bench.id, targetSets: 3 }]
  });
  assert.deepEqual(withPartial.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: null, repMax: null });
});

test('repMax equal to repMin is valid (a fixed rep target, not a range)', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('X', [{ exerciseId: bench.id, targetSets: 5, repMin: 5, repMax: 5 }]);
  assert.deepEqual(session.exercises[0], { exerciseId: bench.id, targetSets: 5, repMin: 5, repMax: 5 });
});

// ---------------------------------------------------------------------
// The critical conceptual rule: a prescription must never leak into an
// actual Workout/Set. Starting a Workout from a prescribed Session must
// produce exactly the same plain exerciseOrder (and zero pre-filled
// sets) as it always has.
// ---------------------------------------------------------------------

test('starting a Workout from a prescribed Session never carries prescription DATA onto the Workout record itself', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 }
  ]);

  const workout = await App.commands.startFromSession(session);

  // exerciseOrder is a plain array of IDs, in the session's order — no
  // prescription objects, no targetSets/repMin/repMax anywhere on the
  // Workout record itself. (Phase 4.3 does seed blank Sets from the
  // prescription — see session-to-workout.test.js — but that's a
  // different thing from the Workout record being contaminated with
  // prescription fields, which is what this test guards against.)
  assert.deepEqual(workout.exerciseOrder, [bench.id, row.id]);
  assert.equal(typeof workout.exerciseOrder[0], 'string');
  assert.equal(workout.targetSets, undefined);
  assert.equal(workout.repMin, undefined);
});

test('a prescribed Session does not constrain what is actually logged: fewer/more sets, different reps and weights', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);

  // The 3 prescribed blank sets are filled in well outside the
  // prescribed rep range and with heavier weight each set — nothing
  // should stop this or alter it — then a 4th, unprescribed set is
  // added on top, mirroring the spec's own example (175x5, 175x5,
  // 175x5, 185x3 against a 3x5-8 prescription).
  const prescribed = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(prescribed.length, 3, 'starts with the 3 prescribed blank sets');
  await App.commands.updateSet(prescribed[0].id, { weight: 225, reps: 20 });
  await App.commands.updateSet(prescribed[1].id, { weight: 230, reps: 1 });
  await App.commands.updateSet(prescribed[2].id, { weight: 235, reps: 1 });
  const s4 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s4.id, { weight: 240, reps: 1 });
  await App.commands.finishWorkout(workout.id);

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 4, 'more sets than prescribed (3) is allowed');
  assert.equal(sets[0].reps, 20, 'reps far outside the prescribed 5-8 range is allowed');

  // The session's own prescription is completely unaffected by what was
  // actually logged.
  const reloadedSession = await App.queries.getSession(session.id);
  assert.deepEqual(reloadedSession.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
});

// ---------------------------------------------------------------------
// 3, 4, 5, 7, 8. Migration: existing (pre-4.1) Sessions, Workouts, and
// Calendar Entries survive the v3->v4 IndexedDB migration intact, with
// session IDs, names, and exercise ordering all preserved, and every
// exercises[] entry normalized to the new shape.
// ---------------------------------------------------------------------

test('a pre-4.1 database migrates safely: Session ids/order normalize, Workouts and Calendar Entries are untouched', async () => {
  const fakeIndexedDB = require('fake-indexeddb');
  const { IDBFactory } = fakeIndexedDB;
  const factory = new IDBFactory();

  // Build a v3-shaped database directly — sessions store exercises as
  // bare exerciseId strings, exactly as every session did before this
  // phase.
  await new Promise((resolve, reject) => {
    const req = factory.open('fitlog_v2', 3);
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
    const tx = db.transaction(['exercises', 'sessions', 'workouts', 'sets', 'calendarEntries'], 'readwrite');
    tx.objectStore('exercises').add({ id: 'ex-bench', name: 'Bench Press', primaryMuscles: [], secondaryMuscles: [], equipment: '', movementType: '' });
    tx.objectStore('exercises').add({ id: 'ex-row', name: 'Barbell Row', primaryMuscles: [], secondaryMuscles: [], equipment: '', movementType: '' });
    tx.objectStore('exercises').add({ id: 'ex-ohp', name: 'OHP', primaryMuscles: [], secondaryMuscles: [], equipment: '', movementType: '' });

    // Ordering matters here — deliberately not alphabetical, so an
    // accidental re-sort during migration would be caught.
    tx.objectStore('sessions').add({
      id: 'old-session', name: 'Upper Strength', color: 'blue',
      exercises: ['ex-ohp', 'ex-bench', 'ex-row'],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    });

    tx.objectStore('workouts').add({
      id: 'old-workout', title: 'Upper Strength', date: '2026-01-05', status: 'completed',
      exerciseOrder: ['ex-ohp', 'ex-bench', 'ex-row'], sessionId: 'old-session',
      notes: '', startedAt: '2026-01-05T09:00:00.000Z', endedAt: '2026-01-05T09:45:00.000Z',
      createdAt: '2026-01-05T09:00:00.000Z', updatedAt: '2026-01-05T09:45:00.000Z'
    });
    tx.objectStore('sets').add({
      id: 'old-set', workoutId: 'old-workout', exerciseId: 'ex-bench', setOrder: 0,
      weight: 135, reps: 8, completedAt: '2026-01-05T09:10:00.000Z'
    });

    tx.objectStore('calendarEntries').add({
      id: 'old-entry', date: '2026-02-01', sessionId: 'old-session', status: 'planned',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    });

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  }));

  // Now open the real, current app source against this same factory —
  // this runs the full v3->v4 migration (and any earlier ones, though
  // this DB was already v3-shaped).
  global.window = global;
  global.indexedDB = factory;
  global.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
  global.App = {};
  global.window.App = global.App;
  for (const rel of ['../js/utils.js', '../js/errors.js', '../js/sessionColors.js', '../js/prescriptions.js', '../js/exerciseMetadata.js', '../js/muscleGroups.js', '../js/db.js', '../js/queries.js', '../js/commands.js', '../js/analytics.js']) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }

  // 4. Session id preserved.
  const migratedSession = await App.queries.getSession('old-session');
  assert.ok(migratedSession, 'the session should still exist under the same id');
  assert.equal(migratedSession.name, 'Upper Strength', 'name preserved');
  assert.equal(migratedSession.color, 'blue', 'color preserved');

  // 5. Exercise ordering preserved exactly (not re-sorted).
  assert.deepEqual(migratedSession.exercises.map(e => e.exerciseId), ['ex-ohp', 'ex-bench', 'ex-row']);

  // 3. Every entry normalized to the new shape, with no prescription yet.
  migratedSession.exercises.forEach((entry) => {
    assert.deepEqual(Object.keys(entry).sort(), ['exerciseId', 'repMax', 'repMin', 'targetSets']);
    assert.equal(entry.targetSets, null);
    assert.equal(entry.repMin, null);
    assert.equal(entry.repMax, null);
  });

  // 7. Historical workout completely untouched (exerciseOrder is still
  // a plain string array, not rewritten into prescription objects; the
  // set inside it is byte-for-byte the same).
  const migratedWorkout = await App.queries.getWorkout('old-workout');
  assert.deepEqual(migratedWorkout.exerciseOrder, ['ex-ohp', 'ex-bench', 'ex-row']);
  assert.equal(migratedWorkout.status, 'completed');
  const migratedSets = await App.queries.getSetsForWorkoutExercise('old-workout', 'ex-bench');
  assert.equal(migratedSets.length, 1);
  assert.equal(migratedSets[0].weight, 135);
  assert.equal(migratedSets[0].reps, 8);
  assert.equal(migratedSets[0].completedAt, '2026-01-05T09:10:00.000Z');

  // 8. Calendar entry completely untouched.
  const entries = await App.db.getAll('calendarEntries');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'old-entry');
  assert.equal(entries[0].date, '2026-02-01');
  assert.equal(entries[0].sessionId, 'old-session');
  assert.equal(entries[0].status, 'planned');

  // A workout can still be started from the migrated session, and it
  // still produces the same plain exercise order.
  const newWorkout = await App.commands.startFromSession(migratedSession);
  assert.deepEqual(newWorkout.exerciseOrder, ['ex-ohp', 'ex-bench', 'ex-row']);
});

// ---------------------------------------------------------------------
// 9. Export/import preserves prescription data, including a legacy
// (pre-4.1) import merged onto an already-prescribed local session.
// ---------------------------------------------------------------------

test('export then import into a fresh app preserves prescription data', async () => {
  const App1 = freshApp();
  const bench = await App1.commands.createExercise('Bench Press');
  const session = await App1.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const backup = await App1.db.exportAll();

  const App2 = freshApp();
  await App2.db.importAll(backup, 'replace');
  const imported = await App2.queries.getSession(session.id);
  assert.deepEqual(imported.exercises, [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
});

test('importing a legacy (pre-4.1, bare-exerciseId) session backup normalizes it cleanly', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const legacyBackup = {
    meta: { app: 'fitlog', formatVersion: 1, exportedAt: '2026-01-01T00:00:00.000Z' },
    stores: {
      exercises: [], sessions: [
        { id: 'legacy-session', name: 'Legacy Upper', color: 'blue', exercises: [bench.id], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
      ],
      workouts: [], sets: [], calendarEntries: [], settings: []
    }
  };

  await App.db.importAll(legacyBackup, 'merge');
  const imported = await App.queries.getSession('legacy-session');
  assert.deepEqual(imported.exercises, [{ exerciseId: bench.id, targetSets: null, repMin: null, repMax: null }]);
});

test('a legacy import merged onto an already-prescribed local session does not blank out its prescriptions', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 }
  ]);

  // An older backup of the SAME session, from before prescriptions
  // existed, being merge-imported back in (e.g. restoring from an old
  // phone backup after already having set prescriptions on this device).
  const legacyBackup = {
    meta: { app: 'fitlog', formatVersion: 1, exportedAt: '2025-01-01T00:00:00.000Z' },
    stores: {
      exercises: [], sessions: [
        { id: session.id, name: session.name, color: session.color, exercises: [bench.id, row.id], createdAt: session.createdAt, updatedAt: session.updatedAt }
      ],
      workouts: [], sets: [], calendarEntries: [], settings: []
    }
  };

  await App.db.importAll(legacyBackup, 'merge');
  const merged = await App.queries.getSession(session.id);
  assert.deepEqual(merged.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }, 'existing prescription must survive a legacy merge-import');
  assert.deepEqual(merged.exercises[1], { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 });
});

// ---------------------------------------------------------------------
// 10. Existing Session functionality continues to work exactly as
// before — creating/renaming/reordering/deleting via plain exerciseId
// arrays (what the current Session editor sends) is unaffected.
// ---------------------------------------------------------------------

test('existing Session functionality (plain exerciseId arrays) still works exactly as before', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const ohp = await App.commands.createExercise('OHP');

  const session = await App.commands.createSession('Upper Body', [bench.id, row.id], 'teal');
  assert.equal(session.name, 'Upper Body');
  assert.equal(session.color, 'teal');
  assert.deepEqual(session.exercises.map(e => e.exerciseId), [bench.id, row.id]);

  // Reorder + add an exercise, exactly as the Session editor does today.
  const renamed = await App.commands.updateSession(session.id, {
    name: 'Upper A', exercises: [row.id, bench.id, ohp.id], color: 'purple'
  });
  assert.equal(renamed.name, 'Upper A');
  assert.equal(renamed.color, 'purple');
  assert.deepEqual(renamed.exercises.map(e => e.exerciseId), [row.id, bench.id, ohp.id]);

  // list summary (session.exercises.length, used on the Train screen)
  // still works regardless of the underlying shape.
  const sessions = await App.queries.getSessions();
  assert.equal(sessions.find(s => s.id === session.id).exercises.length, 3);

  // Starting and deleting still work.
  const workout = await App.commands.startFromSession(renamed);
  assert.deepEqual(workout.exerciseOrder, [row.id, bench.id, ohp.id]);
  await App.commands.finishWorkout(workout.id);

  await App.commands.deleteSession(session.id);
  assert.equal(await App.queries.getSession(session.id), undefined);
});

// ---------------------------------------------------------------------
// Data-integrity correction (post-4.2 review): updateSession() must not
// silently reset a prescription just because the caller supplies a bare
// exerciseId string for an exercise already in the Session. The current
// (Phase 4.2) editor always sends full structured objects, so this only
// matters for other/legacy callers — but losing a prescription this way
// must never be possible.
// ---------------------------------------------------------------------

test('updateSession: a legacy bare-ID update preserves existing prescriptions', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 }
  ]);

  const updated = await App.commands.updateSession(session.id, { exercises: [bench.id, row.id] });
  assert.deepEqual(updated.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(updated.exercises[1], { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 });
});

test("updateSession: reordering via bare IDs preserves each exercise's own prescription", async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 }
  ]);

  const reordered = await App.commands.updateSession(session.id, { exercises: [row.id, bench.id] });
  assert.deepEqual(reordered.exercises[0], { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 });
  assert.deepEqual(reordered.exercises[1], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
});

test("updateSession: removing an exercise (bare-ID list) removes only that exercise's prescription", async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 }
  ]);

  const updated = await App.commands.updateSession(session.id, { exercises: [row.id] });
  assert.equal(updated.exercises.length, 1);
  assert.deepEqual(updated.exercises[0], { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 });
});

test('updateSession: adding a new bare-ID exercise does not alter existing prescriptions', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const updated = await App.commands.updateSession(session.id, { exercises: [bench.id, row.id] });
  assert.deepEqual(updated.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(updated.exercises[1], { exerciseId: row.id, targetSets: null, repMin: null, repMax: null }, 'a brand-new exercise via bare ID gets no prescription');
});

test('updateSession: a structured object is used exactly as supplied, even for an exercise that already had a prescription', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const updated = await App.commands.updateSession(session.id, {
    exercises: [{ exerciseId: bench.id, targetSets: 5 }]
  });
  assert.deepEqual(updated.exercises[0], { exerciseId: bench.id, targetSets: 5, repMin: null, repMax: null }, 'an explicit structured object replaces the old prescription outright, unlike the bare-ID case');
});
