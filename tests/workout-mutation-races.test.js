const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('two concurrent addExerciseToWorkout calls for DIFFERENT exercises both land', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const workout = await App.commands.createWorkout({ exerciseIds: [] });

  // Simulates two rapid taps (or a re-render firing a second action before
  // the first's write has landed) — with a naive get-then-put this would
  // silently lose one of the two additions.
  await Promise.all([
    App.commands.addExerciseToWorkout(workout.id, bench.id),
    App.commands.addExerciseToWorkout(workout.id, row.id)
  ]);

  const updated = await App.queries.getWorkout(workout.id);
  assert.equal(updated.exerciseOrder.length, 2, 'both concurrent additions must be present');
  assert.ok(updated.exerciseOrder.includes(bench.id));
  assert.ok(updated.exerciseOrder.includes(row.id));
});

test('addExerciseToWorkout racing with finishWorkout does not lose the exercise addition', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [] });

  // The exact scenario described: tap "add exercise" then immediately
  // "finish" before the add has committed.
  await Promise.all([
    App.commands.addExerciseToWorkout(workout.id, bench.id),
    App.commands.finishWorkout(workout.id)
  ]);

  const updated = await App.queries.getWorkout(workout.id);
  assert.equal(updated.status, 'completed', 'the finish must still take effect');
  assert.deepEqual(updated.exerciseOrder, [bench.id], 'the exercise addition must not be discarded by the race');
});

test('reorderExercises racing with editWorkoutMeta preserves both changes', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const workout = await App.commands.createWorkout({ title: 'Workout', exerciseIds: [bench.id, row.id] });

  await Promise.all([
    App.commands.reorderExercises(workout.id, [row.id, bench.id]),
    App.commands.editWorkoutMeta(workout.id, { title: 'Upper Body' })
  ]);

  const updated = await App.queries.getWorkout(workout.id);
  assert.equal(updated.title, 'Upper Body', 'the title edit must not be lost');
  assert.deepEqual(updated.exerciseOrder, [row.id, bench.id], 'the reorder must not be lost');
});

test('many concurrent addExerciseToWorkout calls for distinct exercises all land, none duplicated', async () => {
  const App = freshApp();
  const workout = await App.commands.createWorkout({ exerciseIds: [] });
  const exercises = await Promise.all(
    Array.from({ length: 8 }, (_, i) => App.commands.createExercise('Exercise ' + i))
  );

  await Promise.all(exercises.map(ex => App.commands.addExerciseToWorkout(workout.id, ex.id)));

  const updated = await App.queries.getWorkout(workout.id);
  assert.equal(updated.exerciseOrder.length, 8, 'every concurrent addition must land');
  assert.equal(new Set(updated.exerciseOrder).size, 8, 'no duplicates');
});

test('removeExerciseFromWorkout racing with addExerciseToWorkout on different exercises resolves correctly', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const ohp = await App.commands.createExercise('Overhead Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id, row.id] });

  await Promise.all([
    App.commands.removeExerciseFromWorkout(workout.id, bench.id),
    App.commands.addExerciseToWorkout(workout.id, ohp.id)
  ]);

  const updated = await App.queries.getWorkout(workout.id);
  assert.ok(!updated.exerciseOrder.includes(bench.id), 'the removal must take effect');
  assert.ok(updated.exerciseOrder.includes(row.id), 'the untouched exercise must remain');
  assert.ok(updated.exerciseOrder.includes(ohp.id), 'the concurrent addition must not be lost');
});
