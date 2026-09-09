const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('repeatLastWorkout copies exercise structure but zero numbers', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout('Upper A', [bench.id]);
  const [we1] = await App.queries.getWorkoutExercises(w1.id);
  const s1 = await App.commands.addEmptySet(we1);
  await App.commands.updateSet(s1.id, { weight: 115, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.repeatLastWorkout();
  assert.notEqual(w2.id, w1.id);
  assert.equal(w2.title, 'Upper A');

  const [we2] = await App.queries.getWorkoutExercises(w2.id);
  assert.equal(we2.exerciseId, bench.id);
  const sets2 = await App.queries.getSetsForWorkoutExercise(we2.id);
  assert.equal(sets2.length, 0, 'repeat should not pre-fill any historical numbers');
});

test('starting from a template creates the right exercises with no sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const template = {
    id: 't1', name: 'Push Day',
    exercises: [{ exerciseId: row.id, order: 1 }, { exerciseId: bench.id, order: 0 }]
  };

  const workout = await App.commands.startFromTemplate(template);
  const wExercises = await App.queries.getWorkoutExercises(workout.id);
  assert.equal(wExercises.length, 2);
  assert.equal(wExercises[0].exerciseId, bench.id, 'template order should be respected regardless of array order');
});

test('getPreviousPerformance returns the last completed workout, excluding the one in progress', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  const w1 = await App.commands.createWorkout('Day 1', [bench.id]);
  const [we1] = await App.queries.getWorkoutExercises(w1.id);
  const s1 = await App.commands.addEmptySet(we1);
  await App.commands.updateSet(s1.id, { weight: 115, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout('Day 2', [bench.id]);
  const prev = await App.queries.getPreviousPerformance(bench.id, w2.id);
  assert.equal(prev.length, 1);
  assert.equal(prev[0].weight, 115);
  assert.equal(prev[0].reps, 8);
});

test('archiving an exercise hides it from pickers but preserves its history', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout('Day 1', [bench.id]);
  const [we1] = await App.queries.getWorkoutExercises(w1.id);
  const s1 = await App.commands.addEmptySet(we1);
  await App.commands.updateSet(s1.id, { weight: 115, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  await App.commands.archiveExercise(bench.id);

  const active = await App.queries.getExercises(false);
  assert.equal(active.find(e => e.id === bench.id), undefined);

  const all = await App.queries.getExercises(true);
  assert.ok(all.find(e => e.id === bench.id));

  const history = await App.queries.getExerciseHistory(bench.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].sets[0].weight, 115);
});
