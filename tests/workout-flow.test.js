const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('creating a workout sets exerciseOrder and starts active', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');

  const workout = await App.commands.createWorkout({ title: 'Upper', exerciseIds: [bench.id, row.id] });
  assert.equal(workout.status, 'active');
  assert.deepEqual(workout.exerciseOrder, [bench.id, row.id]);
});

test('a new set starts planned and is never auto-completed', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });

  const set = await App.commands.addSet(workout.id, bench.id);
  assert.equal(set.weight, null);
  assert.equal(set.completedAt, null);
  assert.equal(App.commands.isSetCompleted(set), false);
});

test('completedAt is derived: set when both fields exist, cleared if either is removed', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const set = await App.commands.addSet(workout.id, bench.id);

  let updated = await App.commands.updateSet(set.id, { weight: 135 });
  assert.equal(updated.completedAt, null, 'weight alone is not complete');

  updated = await App.commands.updateSet(set.id, { reps: 8 });
  assert.ok(updated.completedAt, 'both fields present -> completed');

  updated = await App.commands.updateSet(set.id, { reps: null });
  assert.equal(updated.completedAt, null, 'clearing a field un-completes the set');
});

test('editing and deleting sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const set = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(set.id, { weight: 135, reps: 8 });

  let sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets[0].weight, 135);

  await App.commands.updateSet(set.id, { weight: 140 });
  sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets[0].weight, 140);
  assert.equal(sets[0].reps, 8, 'unrelated fields untouched by a partial update');

  await App.commands.deleteSet(set.id);
  sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets.length, 0);
});

test('finishing a workout marks it completed with an end time', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });

  await App.commands.finishWorkout(workout.id);
  const finished = await App.queries.getWorkout(workout.id);
  assert.equal(finished.status, 'completed');
  assert.ok(finished.endedAt);
  assert.equal(await App.queries.getActiveWorkout(), null);
});

test('removing an exercise deletes only its own sets and updates exerciseOrder', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id, row.id] });
  await App.commands.addSet(workout.id, bench.id);
  await App.commands.addSet(workout.id, row.id);

  await App.commands.removeExerciseFromWorkout(workout.id, bench.id);

  const updated = await App.queries.getWorkout(workout.id);
  assert.deepEqual(updated.exerciseOrder, [row.id]);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, bench.id)).length, 0);
  assert.equal((await App.queries.getSetsForWorkoutExercise(workout.id, row.id)).length, 1);
});

test('reordering exercises persists the new order', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id, row.id] });

  await App.commands.reorderExercises(workout.id, [row.id, bench.id]);
  const updated = await App.queries.getWorkout(workout.id);
  assert.deepEqual(updated.exerciseOrder, [row.id, bench.id]);
});

test('editWorkoutMeta can change title, date, and notes on a completed workout', async () => {
  const App = freshApp();
  const workout = await App.commands.createWorkout({ title: 'Workout', exerciseIds: [] });
  await App.commands.finishWorkout(workout.id);

  const updated = await App.commands.editWorkoutMeta(workout.id, { title: 'Upper Body', date: '2026-01-05', notes: 'felt strong' });
  assert.equal(updated.title, 'Upper Body');
  assert.equal(updated.date, '2026-01-05');
  assert.equal(updated.notes, 'felt strong');
});

test('deleteWorkout cascades to its sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const set = await App.commands.addSet(workout.id, bench.id);

  await App.commands.deleteWorkout(workout.id);

  assert.equal(await App.queries.getWorkout(workout.id), undefined);
  assert.equal(await App.db.get('sets', set.id), undefined);
});
