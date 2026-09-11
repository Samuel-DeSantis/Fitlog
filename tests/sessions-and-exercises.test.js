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
