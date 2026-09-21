const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

// Phase 4.4 is an audit pass: these tests exist to PROVE the invariants
// established across 4.1-4.3 (and the two follow-up corrections) hold,
// and to guard against regression. No integrity bugs were found during
// this audit — see the accompanying report for what was inspected and
// why each area is safe. A couple of scenarios below were previously
// only implied by other tests; they're made explicit here for direct
// traceability against the Phase 4.4 required-scenario list.

async function setUpUpperStrength(App) {
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  return { bench, session };
}

// ---------------------------------------------------------------------
// 1, 2, 3. Completing exactly the prescribed count, more, or fewer sets
// are all valid, and never touch the Session.
// ---------------------------------------------------------------------

test('1. Session 3x5-8 -> Workout completes exactly 3 sets', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3);

  for (const s of sets) await App.commands.updateSet(s.id, { weight: 175, reps: 6 });
  await App.commands.finishWorkout(workout.id);

  const finalSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(finalSets.length, 3);
  assert.ok(finalSets.every(s => App.commands.isSetCompleted(s)));

  const reloadedSession = await App.queries.getSession(session.id);
  assert.deepEqual(reloadedSession.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
});

test('2. Session 3x5-8 -> Workout completes 4 sets (one more than prescribed)', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const prescribed = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  for (const s of prescribed) await App.commands.updateSet(s.id, { weight: 175, reps: 5 });
  const extra = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(extra.id, { weight: 185, reps: 3 });
  await App.commands.finishWorkout(workout.id);

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 4);
  assert.ok(sets.every(s => App.commands.isSetCompleted(s)));

  const reloadedSession = await App.queries.getSession(session.id);
  assert.equal(reloadedSession.exercises[0].targetSets, 3, "the extra set never changes the Session's own prescription");
});

test('3. Session 3x5-8 -> Workout completes only 2 sets (fewer than prescribed)', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const prescribed = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);

  await App.commands.updateSet(prescribed[0].id, { weight: 175, reps: 5 });
  await App.commands.updateSet(prescribed[1].id, { weight: 175, reps: 5 });
  // prescribed[2] deliberately left blank/unconfirmed.
  const finished = await App.commands.finishWorkout(workout.id);

  assert.equal(finished.status, 'completed', 'finishing with fewer than prescribed completed is allowed at the command layer (the incomplete-set warning is a UI-layer confirmation, not a command-layer rule)');
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3, 'the un-filled-in third set is still there, just incomplete');
  assert.equal(App.commands.isSetCompleted(sets[2]), false);
});

// ---------------------------------------------------------------------
// 4. Actual reps/weight are independent of the prescribed range — no
// validation anywhere rejects or clamps a Set against repMin/repMax.
// ---------------------------------------------------------------------

test('4. Workout records reps outside the prescribed range without being rejected or altered', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App); // prescribed 5-8
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);

  const low = await App.commands.updateSet(sets[0].id, { weight: 225, reps: 3 }); // below repMin
  const high = await App.commands.updateSet(sets[1].id, { weight: 95, reps: 20 }); // above repMax
  assert.equal(low.reps, 3);
  assert.equal(high.reps, 20);
  assert.equal(App.commands.isSetCompleted(low), true);
  assert.equal(App.commands.isSetCompleted(high), true);
});

// ---------------------------------------------------------------------
// 5. Editing the Session after Workout creation never rewrites that
// Workout.
// ---------------------------------------------------------------------

test('5. Editing the Session (prescription values) after Workout creation does not modify that Workout', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const before = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(before[0].id, { weight: 175, reps: 5 });

  await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 5, repMin: 3, repMax: 5 });

  const after = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(after.length, 3, 'the already-created Workout keeps exactly the sets it had — no new blank sets appear');
  assert.equal(after[0].weight, 175);
  assert.equal(after[0].reps, 5);
  assert.equal(App.commands.isSetCompleted(after[1]), false);
});

// ---------------------------------------------------------------------
// 6. Reordering the Session's exercises after Workout creation never
// reorders (or otherwise touches) that Workout's exerciseOrder or sets.
// ---------------------------------------------------------------------

test('6. Reordering the Session after Workout creation does not reorder or otherwise touch that Workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 }
  ]);
  const workout = await App.commands.startFromSession(session);
  const originalOrder = [...workout.exerciseOrder];

  // Reorder the Session — Row now comes first.
  await App.commands.updateSession(session.id, { exercises: [row.id, bench.id] });
  const reorderedSession = await App.queries.getSession(session.id);
  assert.equal(reorderedSession.exercises[0].exerciseId, row.id);

  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.deepEqual(reloadedWorkout.exerciseOrder, originalOrder, "the existing Workout's exercise order is completely unaffected by reordering the Session afterward");
  assert.deepEqual(reloadedWorkout.exerciseOrder, [bench.id, row.id]);
});

// ---------------------------------------------------------------------
// 7. Removing an exercise from the Session after Workout creation never
// removes that exercise (or its sets) from the already-created Workout.
// ---------------------------------------------------------------------

test('7. Removing a Session exercise after Workout creation leaves that exercise and its sets in the Workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 }
  ]);
  const workout = await App.commands.startFromSession(session);
  await App.commands.updateSet((await App.queries.getSetsForWorkoutExercise(workout.id, row.id))[0].id, { weight: 95, reps: 8 });

  // Remove Row from the Session entirely.
  await App.commands.updateSession(session.id, { exercises: [bench.id] });
  const updatedSession = await App.queries.getSession(session.id);
  assert.equal(updatedSession.exercises.length, 1);

  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.deepEqual(reloadedWorkout.exerciseOrder, [bench.id, row.id], "the Workout still has Row in its exerciseOrder — removing it from the Session doesn't retroactively remove it from an existing Workout");
  const rowSets = await App.queries.getSetsForWorkoutExercise(workout.id, row.id);
  assert.equal(rowSets.length, 3, "Row's sets (including the logged one) are untouched");
  assert.equal(rowSets[0].weight, 95);
});

// ---------------------------------------------------------------------
// 8. Historically editing a Workout after Session changes works
// normally, and doesn't further perturb the Session.
// ---------------------------------------------------------------------

test('8. A Workout can be historically edited after Session changes, without affecting the Session further', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  for (const s of sets) await App.commands.updateSet(s.id, { weight: 175, reps: 5 });
  await App.commands.finishWorkout(workout.id);

  // The Session changes after the Workout is already completed/historical.
  await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 5, repMin: 3, repMax: 5 });

  // Now historically edit the completed Workout — add a set, edit a
  // value, add a whole new exercise.
  const extra = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(extra.id, { weight: 180, reps: 4 });
  await App.commands.updateSet(sets[0].id, { weight: 200, reps: 3 });
  const squat = await App.commands.createExercise('Squat');
  await App.commands.addExerciseToWorkout(workout.id, squat.id);

  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.equal(reloadedWorkout.status, 'completed', 'historical editing does not reactivate the Workout');
  const finalSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(finalSets.length, 4);
  assert.equal(finalSets[0].weight, 200);
  assert.ok(reloadedWorkout.exerciseOrder.includes(squat.id));

  // And the Session's prescription (already changed above) is exactly
  // what was set — the historical edit didn't change it further.
  const reloadedSession = await App.queries.getSession(session.id);
  assert.deepEqual(reloadedSession.exercises[0], { exerciseId: bench.id, targetSets: 5, repMin: 3, repMax: 5 });
});

// ---------------------------------------------------------------------
// 9. Blank prescribed sets never count as completed performance data.
// ---------------------------------------------------------------------

test('9. Blank prescribed sets do not count as completed performance', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);

  sets.forEach((s) => {
    assert.equal(App.commands.isSetCompleted(s), false);
    assert.equal(s.weight, null);
    assert.equal(s.reps, null);
  });

  // They also don't surface as "previous performance" for a later
  // workout, since getPreviousPerformance only ever returns completedAt
  // != null sets.
  await App.commands.finishWorkout(workout.id); // finished with all 3 still blank
  const nextWorkout = await App.commands.startFromSession(await App.queries.getSession(session.id));
  const prev = await App.queries.getPreviousPerformance(bench.id, nextWorkout.id);
  assert.equal(prev, null, 'an all-blank finished workout has no completed sets, so there is nothing to show as previous performance');
});

// ---------------------------------------------------------------------
// 10, 11. Export/import round-trips Session prescriptions and remains
// compatible with legacy (pre-4.1) backups, without disturbing anything
// else.
// ---------------------------------------------------------------------

test('10. Export -> import preserves Session prescriptions exactly, alongside Workouts/Sets/Calendar Entries', async () => {
  const App1 = freshApp();
  const { bench, session } = await setUpUpperStrength(App1);
  const workout = await App1.commands.startFromSession(session);
  const sets = await App1.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App1.commands.updateSet(sets[0].id, { weight: 175, reps: 5 });
  await App1.commands.finishWorkout(workout.id);
  const entry = await App1.commands.planCalendarEntry('2026-04-01', session.id);

  const backup = await App1.db.exportAll();

  const App2 = freshApp();
  await App2.db.importAll(backup, 'replace');

  const importedSession = await App2.queries.getSession(session.id);
  assert.deepEqual(importedSession.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });

  const importedWorkout = await App2.queries.getWorkout(workout.id);
  assert.equal(importedWorkout.status, 'completed');
  assert.deepEqual(importedWorkout.exerciseOrder, [bench.id]);
  const importedSets = await App2.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(importedSets.length, 3);
  assert.equal(importedSets[0].weight, 175);

  const importedEntry = await App2.queries.getCalendarEntry(entry.id);
  assert.equal(importedEntry.sessionId, session.id);
  assert.equal(importedEntry.date, '2026-04-01');
});

test('11. A legacy (pre-4.1) backup imports compatibly: bare-string sessions normalize, real Workouts/Sets are untouched', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  // A real, already-completed workout exists locally before the import.
  const localWorkout = await App.commands.createWorkout({ title: 'Local', exerciseIds: [bench.id] });
  const localSet = await App.commands.addSet(localWorkout.id, bench.id);
  await App.commands.updateSet(localSet.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(localWorkout.id);

  const legacyBackup = {
    meta: { formatVersion: 1, exportedAt: '2025-01-01T00:00:00.000Z' },
    stores: {
      exercises: [],
      sessions: [{ id: 'legacy-session', name: 'Legacy Upper', color: 'blue', exercises: [bench.id], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }],
      workouts: [], sets: [], calendarEntries: [], settings: []
    }
  };
  await App.db.importAll(legacyBackup, 'merge');

  const importedSession = await App.queries.getSession('legacy-session');
  assert.deepEqual(importedSession.exercises, [{ exerciseId: bench.id, targetSets: null, repMin: null, repMax: null }]);

  // The pre-existing local workout/set data is completely untouched by
  // this merge-import.
  const reloadedLocalWorkout = await App.queries.getWorkout(localWorkout.id);
  assert.equal(reloadedLocalWorkout.status, 'completed');
  const reloadedLocalSets = await App.queries.getSetsForWorkoutExercise(localWorkout.id, bench.id);
  assert.equal(reloadedLocalSets.length, 1);
  assert.equal(reloadedLocalSets[0].weight, 135);

  // The legacy session can still be used to start a workout normally.
  const newWorkout = await App.commands.startFromSession(importedSession);
  assert.deepEqual(newWorkout.exerciseOrder, [bench.id]);
  assert.equal((await App.queries.getSetsForWorkoutExercise(newWorkout.id, bench.id)).length, 0, 'no prescription -> no pre-created sets, as always');
});

// ---------------------------------------------------------------------
// 12. A Calendar-planned Session stays correctly associated with the
// Workout it produces.
// ---------------------------------------------------------------------

test('12. A Calendar-planned Session remains correctly associated with its Workout', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const entry = await App.commands.planCalendarEntry('2026-04-05', session.id);

  const { entry: updatedEntry, workout } = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(updatedEntry.workoutId, workout.id);
  assert.equal(workout.sessionId, session.id);
  assert.equal(workout.date, '2026-04-05');

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3);

  // The association survives further Session edits.
  await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 10 });
  const reloadedEntry = await App.queries.getCalendarEntry(entry.id);
  assert.equal(reloadedEntry.workoutId, workout.id, 'the entry-to-workout link is unaffected by later Session edits');
  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.equal(reloadedWorkout.sessionId, session.id);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 3, 'the already-created sets are not retroactively topped up to the new targetSets');
});

// ---------------------------------------------------------------------
// 13, 14. Deleting a Workout never deletes its Session, and deleting a
// Session never rewrites (or deletes) historical Workouts.
// ---------------------------------------------------------------------

test('13. Deleting a Workout does not delete the Session it came from', async () => {
  const App = freshApp();
  const { session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);

  await App.commands.deleteWorkout(workout.id);

  const reloadedSession = await App.queries.getSession(session.id);
  assert.ok(reloadedSession, 'the Session must still exist');
  assert.equal(reloadedSession.name, 'Upper Strength');
  assert.equal(reloadedSession.exercises.length, 1);
  assert.equal(await App.queries.getWorkout(workout.id), undefined);
});

test('14. Deleting a Session does not rewrite or delete historical Workouts', async () => {
  const App = freshApp();
  const { bench, session } = await setUpUpperStrength(App);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  for (const s of sets) await App.commands.updateSet(s.id, { weight: 175, reps: 5 });
  await App.commands.finishWorkout(workout.id);

  await App.commands.deleteSession(session.id);
  assert.equal(await App.queries.getSession(session.id), undefined);

  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.ok(reloadedWorkout, 'the historical Workout must still exist');
  assert.equal(reloadedWorkout.status, 'completed');
  assert.equal(reloadedWorkout.sessionId, session.id, "the Workout's own sessionId reference is left as-is (a dangling id is fine — it's history, and nothing dereferences it to require the Session to still exist)");
  const reloadedSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(reloadedSets.length, 3);
  assert.equal(reloadedSets[0].weight, 175);
  assert.equal(reloadedSets[0].reps, 5);
});

// ---------------------------------------------------------------------
// Extra: resuming an already-active Workout must not retroactively pull
// in a Session edit made in the meantime (a subtler case of invariant 7
// — even the "same session, still active" resume path must not sync).
// ---------------------------------------------------------------------

test('Extra: resuming an active Workout does not retroactively apply a Session edit made while it was active', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);

  // While that workout is still active, the Session gains a new
  // exercise with its own prescription.
  await App.commands.updateSession(session.id, {
    exercises: [
      { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
      { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 }
    ]
  });

  // "Resuming" (tapping Start on the same session again) must return the
  // SAME workout, unchanged — not add Row's prescribed sets to it.
  const updatedSession = await App.queries.getSession(session.id);
  const resumed = await App.commands.startFromSession(updatedSession);
  assert.equal(resumed.id, workout.id);
  assert.deepEqual(resumed.exerciseOrder, [bench.id], 'the active workout is not retroactively expanded to include the newly-added exercise');
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, row.id)).length, 0);
});
