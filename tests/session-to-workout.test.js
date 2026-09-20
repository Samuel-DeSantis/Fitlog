const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, reopenApp } = require('./helpers/setup');

// ---------------------------------------------------------------------
// 1, 2, 3. Starting a Session creates the prescribed number of blank,
// unconfirmed sets, which do not count as completed performance.
// ---------------------------------------------------------------------

test('starting a Session creates the prescribed number of blank, unconfirmed sets per exercise', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const ohp = await App.commands.createExercise('OHP');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    { exerciseId: row.id, targetSets: 3, repMin: 6, repMax: 10 },
    { exerciseId: ohp.id, targetSets: 2, repMin: 6, repMax: 10 }
  ]);

  const workout = await App.commands.startFromSession(session);

  const benchSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  const rowSets = await App.queries.getSetsForWorkoutExercise(workout.id, row.id);
  const ohpSets = await App.queries.getSetsForWorkoutExercise(workout.id, ohp.id);
  assert.equal(benchSets.length, 3);
  assert.equal(rowSets.length, 3);
  assert.equal(ohpSets.length, 2);

  // setOrder is sequential starting at 0, independently per exercise.
  assert.deepEqual(benchSets.map(s => s.setOrder), [0, 1, 2]);
  assert.deepEqual(ohpSets.map(s => s.setOrder), [0, 1]);

  // Every prescribed set is blank and unconfirmed — not completed
  // performance data.
  [...benchSets, ...rowSets, ...ohpSets].forEach((s) => {
    assert.equal(s.weight, null);
    assert.equal(s.reps, null);
    assert.equal(s.completedAt, null);
    assert.equal(App.commands.isSetCompleted(s), false);
  });

  const allSets = await App.queries.getSetsForWorkout(workout.id);
  assert.equal(allSets.length, 8);
  assert.equal(allSets.filter(s => !App.commands.isSetCompleted(s)).length, 8, 'every prescribed set is still incomplete');
});

test('a Session with SOME exercises prescribed and others not creates blank sets only where prescribed', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Mixed', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 },
    row.id // no prescription for this one
  ]);

  const workout = await App.commands.startFromSession(session);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 3);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, row.id)).length, 0);
});

// ---------------------------------------------------------------------
// 4, 5, 7. Extra sets beyond the prescription are fully part of the
// actual Workout, including via the existing Add Set / copy-forward
// behavior.
// ---------------------------------------------------------------------

test('a user can add an extra set beyond the prescribed count, and it remains part of the Workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);

  const extra = await App.commands.addSet(workout.id, bench.id);
  assert.equal(extra.setOrder, 3, 'appended after the 3 prescribed sets');
  assert.equal(extra.weight, null, 'nothing to copy from — the prescribed sets ahead of it are still blank');

  await App.commands.updateSet(extra.id, { weight: 200, reps: 5 });
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 4);
  assert.equal(sets[3].weight, 200);
  assert.equal(App.commands.isSetCompleted(sets[3]), true);
});

test('Add Set still copies forward from the most recent valid set, even when that set was originally a prescribed blank one', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 2, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);
  const prescribed = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(prescribed[0].id, { weight: 135, reps: 8 });
  // prescribed[1] stays blank/unconfirmed.

  const extra = await App.commands.addSet(workout.id, bench.id);
  assert.equal(extra.weight, 135, "copies the most recent set with real values, skipping the still-blank prescribed one");
  assert.equal(extra.reps, 8);
  assert.equal(App.commands.isSetCompleted(extra), false, 'a copied value is still unconfirmed until explicitly confirmed');
});

test('a user can perform more sets than prescribed', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 2, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 2);

  await App.commands.addSet(workout.id, bench.id);
  await App.commands.addSet(workout.id, bench.id);
  await App.commands.addSet(workout.id, bench.id);

  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 5, '2 prescribed + 3 added');
});

// ---------------------------------------------------------------------
// 6. Completing fewer than the prescribed number of sets is allowed —
// finishWorkout itself never blocks on it (the incomplete-set warning is
// a UI-layer confirmation from Phase 3, not a command-layer rule).
// ---------------------------------------------------------------------

test('a user can complete fewer than the prescribed number of sets, and finishing is not blocked', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);

  await App.commands.updateSet(sets[0].id, { weight: 135, reps: 8 });
  // sets[1] and sets[2] are left blank.

  const incomplete = (await App.queries.getSetsForWorkout(workout.id)).filter(s => !App.commands.isSetCompleted(s));
  assert.equal(incomplete.length, 2, "the other 2 prescribed sets remain incomplete — what the workout screen's finish warning counts");

  const finished = await App.commands.finishWorkout(workout.id);
  assert.equal(finished.status, 'completed');
});

// ---------------------------------------------------------------------
// 8, 9. Different weights/reps, and changing the Session afterward,
// never affect each other — historical integrity in both directions.
// ---------------------------------------------------------------------

test('changing the Session after starting a Workout never modifies that Workout, and logging different numbers never modifies the Session', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  // "Monday": start and log a workout with real numbers that ignore the
  // prescribed rep range, plus one set beyond what was prescribed —
  // mirroring the spec's own example (175x5, 175x5, 175x5, 185x3 against
  // a 3x5-8 prescription).
  const mondayWorkout = await App.commands.startFromSession(session);
  const mondaySets = await App.queries.getSetsForWorkoutExercise(mondayWorkout.id, bench.id);
  await App.commands.updateSet(mondaySets[0].id, { weight: 175, reps: 5 });
  await App.commands.updateSet(mondaySets[1].id, { weight: 175, reps: 5 });
  await App.commands.updateSet(mondaySets[2].id, { weight: 175, reps: 5 });
  const extra = await App.commands.addSet(mondayWorkout.id, bench.id);
  await App.commands.updateSet(extra.id, { weight: 185, reps: 3 });
  await App.commands.finishWorkout(mondayWorkout.id);

  // The session's prescription is untouched by any of that.
  let reloadedSession = await App.queries.getSession(session.id);
  assert.deepEqual(reloadedSession.exercises[0], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });

  // "Wednesday": the session's prescription changes...
  await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 4 });
  reloadedSession = await App.queries.getSession(session.id);
  assert.equal(reloadedSession.exercises[0].targetSets, 4);

  // ...but Monday's already-created workout remains exactly as recorded.
  const reloadedMonday = await App.queries.getWorkout(mondayWorkout.id);
  const reloadedMondaySets = await App.queries.getSetsForWorkoutExercise(mondayWorkout.id, bench.id);
  assert.equal(reloadedMondaySets.length, 4, "Monday's workout still has exactly the 4 sets actually logged");
  assert.deepEqual(reloadedMondaySets.map(s => s.weight), [175, 175, 175, 185]);
  assert.equal(reloadedMonday.status, 'completed');
});

// ---------------------------------------------------------------------
// 10. Starting from a Calendar Entry preserves the existing Calendar
// relationship, and also seeds prescribed sets; resuming never
// duplicates them.
// ---------------------------------------------------------------------

test('starting from a planned Calendar Entry creates prescribed blank sets and preserves the entry-to-workout link', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const entry = await App.commands.planCalendarEntry('2026-03-10', session.id);

  const { entry: updatedEntry, workout } = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(updatedEntry.workoutId, workout.id, 'the calendar entry is linked to the new workout');
  assert.equal(workout.date, '2026-03-10', "the workout is dated to the entry's planned date, not today");

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3);
  sets.forEach(s => assert.equal(App.commands.isSetCompleted(s), false));

  // Calling it again for the same entry resumes the same workout — no
  // second batch of blank sets is created.
  const second = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(second.workout.id, workout.id);
  const setsAgain = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(setsAgain.length, 3, 'resuming must not duplicate the prescribed sets');
});

// ---------------------------------------------------------------------
// 11. Active-workout conflict behavior is unaffected.
// ---------------------------------------------------------------------

test('active-workout conflict behavior is unaffected by prescribed sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const first = await App.commands.startFromSession(session);

  // A second, unrelated free-form "start" resolves to the SAME already-
  // active workout, rather than creating a new one or duplicating sets.
  const second = await App.commands.startWorkout('Workout', []);
  assert.equal(second.id, first.id);
  assert.equal((await App.queries.getSetsForWorkoutExercise(first.id, bench.id)).length, 3, 'unaffected by the resolved-to-existing call');

  // A planned Calendar Entry for a DIFFERENT session, started while this
  // one is active, must still refuse via the existing conflict error.
  const other = await App.commands.createSession('Lower', []);
  const entry = await App.commands.planCalendarEntry('2026-03-11', other.id);
  await assert.rejects(
    () => App.commands.startPlannedWorkout(entry.id),
    App.errors.ActiveWorkoutConflictError
  );
});

// ---------------------------------------------------------------------
// 12. Existing Sessions with missing/legacy prescription data still
// start successfully, with no pre-created sets (unchanged from before
// this phase).
// ---------------------------------------------------------------------

test('a Session with legacy/missing prescription data (bare exerciseId strings) still starts successfully, with no pre-created sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Legacy Upper', [bench.id, row.id]);

  const workout = await App.commands.startFromSession(session);
  assert.deepEqual(workout.exerciseOrder, [bench.id, row.id]);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 0, 'no targetSets -> no pre-created sets, exactly as before this phase');
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, row.id)).length, 0);
});

// ---------------------------------------------------------------------
// backfillWorkout also seeds prescribed sets (explicitly in scope:
// "Update backfill behavior as necessary").
// ---------------------------------------------------------------------

test('backfillWorkout also seeds prescribed blank sets from the Session', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const workout = await App.commands.backfillWorkout('2026-01-05', session.id);
  assert.equal(workout.status, 'completed');
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3);
  sets.forEach(s => assert.equal(App.commands.isSetCompleted(s), false));
});

test('backfillWorkout with no session (freeform) creates no sets, same as before this phase', async () => {
  const App = freshApp();
  const workout = await App.commands.backfillWorkout('2026-01-05', null);
  assert.deepEqual(workout.exerciseOrder, []);
  assert.equal((await App.queries.getSetsForWorkout(workout.id)).length, 0);
});

// ---------------------------------------------------------------------
// Reload/resume of a Workout containing prescribed blank sets.
// ---------------------------------------------------------------------

test('reload/resume: a Workout with prescribed blank sets survives a simulated app restart intact', async () => {
  let App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(sets[0].id, { weight: 135, reps: 8 });

  App = reopenApp();
  const resumedActive = await App.queries.getActiveWorkout();
  assert.equal(resumedActive.id, workout.id);

  const resumedSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(resumedSets.length, 3, 'all 3 prescribed sets survive a reload');
  assert.equal(resumedSets[0].weight, 135, 'the one already filled in keeps its value');
  assert.equal(App.commands.isSetCompleted(resumedSets[0]), true);
  assert.equal(App.commands.isSetCompleted(resumedSets[1]), false);
  assert.equal(App.commands.isSetCompleted(resumedSets[2]), false);
});
