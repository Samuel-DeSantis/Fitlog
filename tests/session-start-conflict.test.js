const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

// ---------------------------------------------------------------------
// No active workout: creates the correct Workout and prescribed sets,
// exactly as Phase 4.3 established.
// ---------------------------------------------------------------------

test('startFromSession with no active workout creates the Session-based Workout and its prescribed sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const workout = await App.commands.startFromSession(session);
  assert.equal(workout.status, 'active');
  assert.equal(workout.sessionId, session.id);
  assert.deepEqual(workout.exerciseOrder, [bench.id]);

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 3);
  sets.forEach(s => assert.equal(App.commands.isSetCompleted(s), false));
});

// ---------------------------------------------------------------------
// An unrelated active workout: throws ActiveWorkoutConflictError, and
// leaves everything exactly as it was.
// ---------------------------------------------------------------------

test('starting a different Session while an unrelated Workout is active throws ActiveWorkoutConflictError', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const squat = await App.commands.createExercise('Squat');
  const legsSession = await App.commands.createSession('Legs', [
    { exerciseId: squat.id, targetSets: 4, repMin: 5, repMax: 8 }
  ]);
  const upperSession = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const legsWorkout = await App.commands.startFromSession(legsSession);

  await assert.rejects(
    () => App.commands.startFromSession(upperSession),
    App.errors.ActiveWorkoutConflictError
  );

  // The existing active workout is completely unchanged by the refused
  // attempt.
  const reloadedLegsWorkout = await App.queries.getWorkout(legsWorkout.id);
  assert.deepEqual(reloadedLegsWorkout, legsWorkout);
  assert.equal(reloadedLegsWorkout.status, 'active');

  // No second workout, and no prescribed sets for the refused session,
  // were created.
  const allWorkouts = await App.db.getAll('workouts');
  assert.equal(allWorkouts.length, 1, 'no second workout should exist');
  assert.equal(allWorkouts[0].id, legsWorkout.id);

  const allSets = await App.db.getAll('sets');
  assert.equal(allSets.length, 4, "only Legs' own 4 prescribed sets exist — none for the refused Upper Strength session");
  assert.ok(allSets.every(s => s.exerciseId === squat.id));
});

test('a corrupted multi-active state is still surfaced explicitly by startFromSession, never silently resolved', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [{ exerciseId: bench.id, targetSets: 3 }]);
  await App.db.put('workouts', { id: 'w1', title: 'A', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: 'a', endedAt: null, createdAt: '', updatedAt: '' });
  await App.db.put('workouts', { id: 'w2', title: 'B', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: 'b', endedAt: null, createdAt: '', updatedAt: '' });

  await assert.rejects(() => App.commands.startFromSession(session), App.errors.MultipleActiveWorkoutsError);
  const rows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(rows.length, 2, 'no auto-repair happened');
});

// ---------------------------------------------------------------------
// Resuming: if the already-active workout IS this same Session, that's
// a resume, not a conflict — mirroring startPlannedWorkout's own
// resume-via-link behavior, just keyed on sessionId here.
// ---------------------------------------------------------------------

test('starting the SAME Session again while its own Workout is still active resumes it, without duplicating sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  const first = await App.commands.startFromSession(session);
  const second = await App.commands.startFromSession(session);

  assert.equal(second.id, first.id);
  const allWorkouts = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(allWorkouts.length, 1);
  const sets = await App.queries.getSetsForWorkoutExercise(first.id, bench.id);
  assert.equal(sets.length, 3, 'resuming must not create a second batch of prescribed sets');
});

// ---------------------------------------------------------------------
// Existing generic startWorkout() behavior is unchanged: it still
// resumes whatever is active, regardless of relatedness.
// ---------------------------------------------------------------------

test('startWorkout (free-form) still resumes whatever workout is active, unaffected by this correction', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const sessionWorkout = await App.commands.startFromSession(session);

  // A completely unrelated free-form start must still just resume it —
  // startWorkout never passes requireRelated.
  const resumed = await App.commands.startWorkout('Workout', []);
  assert.equal(resumed.id, sessionWorkout.id);

  const allWorkouts = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(allWorkouts.length, 1);
});

// ---------------------------------------------------------------------
// Existing Calendar/planned-workout conflict behavior is unchanged.
// ---------------------------------------------------------------------

test('startPlannedWorkout conflict behavior is unchanged by this correction', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const squat = await App.commands.createExercise('Squat');
  const upperSession = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);
  const legsSession = await App.commands.createSession('Legs', [
    { exerciseId: squat.id, targetSets: 4, repMin: 5, repMax: 8 }
  ]);

  await App.commands.startFromSession(upperSession);

  const legsEntry = await App.commands.planCalendarEntry('2026-03-11', legsSession.id);
  await assert.rejects(
    () => App.commands.startPlannedWorkout(legsEntry.id),
    App.errors.ActiveWorkoutConflictError
  );

  // And the reverse direction: an active workout started via a planned
  // entry still correctly blocks startFromSession for an unrelated
  // Session, same as two Session-originated starts would.
  const App2 = freshApp();
  const bench2 = await App2.commands.createExercise('Bench Press');
  const squat2 = await App2.commands.createExercise('Squat');
  const plannedSession = await App2.commands.createSession('Upper Strength', [{ exerciseId: bench2.id, targetSets: 3 }]);
  const otherSession = await App2.commands.createSession('Legs', [{ exerciseId: squat2.id, targetSets: 4 }]);
  const plannedEntry = await App2.commands.planCalendarEntry('2026-03-12', plannedSession.id);
  await App2.commands.startPlannedWorkout(plannedEntry.id);

  await assert.rejects(
    () => App2.commands.startFromSession(otherSession),
    App2.errors.ActiveWorkoutConflictError
  );
});
