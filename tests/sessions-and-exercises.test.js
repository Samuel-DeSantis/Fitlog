const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('starting from a session creates the right exercises in order, no sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Body', [bench.id, row.id]);

  const workout = await App.commands.startFromSession(session);
  assert.deepEqual(workout.exerciseOrder, [bench.id, row.id]);
  assert.equal(workout.sessionId, session.id);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 0);
});

test('updateSession changes name/exercises without affecting past workouts', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const session = await App.commands.createSession('Upper Body', [bench.id]);
  const workout = await App.commands.startFromSession(session);
  await App.commands.finishWorkout(workout.id);

  await App.commands.updateSession(session.id, { name: 'Upper A', exercises: [bench.id, row.id] });

  const unchanged = await App.queries.getWorkout(workout.id);
  assert.deepEqual(unchanged.exerciseOrder, [bench.id], 'historical workout is untouched by a session edit');

  const updatedSession = await App.queries.getSession(session.id);
  assert.equal(updatedSession.name, 'Upper A');
});

test('getPreviousPerformance returns the last completed workout, excluding the one in progress', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const prev = await App.queries.getPreviousPerformance(bench.id, w2.id);
  assert.equal(prev.length, 1);
  assert.equal(prev[0].weight, 135);
});

test('getPreviousPerformance omits incomplete/unconfirmed sets from the matched workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });

  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 135, reps: 8 }); // completed

  // A second set that got copied values (weight+reps both present) but
  // was never confirmed — finishing the workout anyway (per the
  // finish-with-incomplete-sets warning) leaves it on the books as
  // logged-but-not-done. It must not show up as "previous performance".
  const s2 = await App.commands.addSet(w1.id, bench.id);
  await App.db.put('sets', { ...s2, weight: 135, reps: 6, completedAt: null });
  assert.equal(App.commands.isSetCompleted({ ...s2, weight: 135, reps: 6, completedAt: null }), false);

  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const prev = await App.queries.getPreviousPerformance(bench.id, w2.id);
  assert.equal(prev.length, 1, 'only the completed set should be returned');
  assert.equal(prev[0].reps, 8);
});

test('getPreviousPerformance falls back to an earlier workout if the nearest one has no completed sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  // A more recent workout for the same exercise, finished with its only
  // set left incomplete/unconfirmed.
  const w2 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s2 = await App.commands.addSet(w2.id, bench.id);
  await App.db.put('sets', { ...s2, weight: 140, reps: 5, completedAt: null });
  await App.commands.finishWorkout(w2.id);

  const w3 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const prev = await App.queries.getPreviousPerformance(bench.id, w3.id);
  assert.ok(prev, 'should fall back to the earlier workout that actually has completed sets');
  assert.equal(prev.length, 1);
  assert.equal(prev[0].weight, 135, 'the incomplete-only workout must be skipped entirely');
});

test('getPreviousPerformance returns null when no history has any completed sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.db.put('sets', { ...s1, weight: 135, reps: 8, completedAt: null });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const prev = await App.queries.getPreviousPerformance(bench.id, w2.id);
  assert.equal(prev, null);
});

test('archiving an exercise hides it from active pickers but preserves its history', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  await App.commands.archiveExercise(bench.id);

  assert.equal((await App.queries.getExercises(false)).find(e => e.id === bench.id), undefined);
  assert.ok((await App.queries.getExercises(true)).find(e => e.id === bench.id));

  const history = await App.queries.getExerciseHistory(bench.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].sets[0].weight, 135);
});
