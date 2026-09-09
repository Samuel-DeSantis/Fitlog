const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

async function seedExercise(App, name) {
  return App.commands.createExercise(name, 'Chest', 'Barbell');
}

test('creating a workout also creates ordered workoutExercise rows', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const row = await seedExercise(App, 'Barbell Row');

  const workout = await App.commands.createWorkout('Upper', [bench.id, row.id]);
  assert.equal(workout.status, 'in_progress');

  const wExercises = await App.queries.getWorkoutExercises(workout.id);
  assert.equal(wExercises.length, 2);
  assert.equal(wExercises[0].exerciseId, bench.id);
  assert.equal(wExercises[0].order, 0);
  assert.equal(wExercises[1].order, 1);
});

test('a new set starts planned (incomplete) and is never auto-completed', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);
  const [we] = await App.queries.getWorkoutExercises(workout.id);

  const set = await App.commands.addEmptySet(we);
  assert.equal(set.weight, null);
  assert.equal(set.reps, null);
  assert.equal(App.commands.isSetCompleted(set), false);
});

test('a set becomes completed only once it has both weight and reps', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);
  const [we] = await App.queries.getWorkoutExercises(workout.id);
  const set = await App.commands.addEmptySet(we);

  let updated = await App.commands.updateSet(set.id, { weight: 115 });
  assert.equal(App.commands.isSetCompleted(updated), false, 'weight alone is not complete');

  updated = await App.commands.updateSet(set.id, { reps: 8 });
  assert.equal(App.commands.isSetCompleted(updated), true);
});

test('editing and deleting sets', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);
  const [we] = await App.queries.getWorkoutExercises(workout.id);

  const set = await App.commands.addEmptySet(we);
  await App.commands.updateSet(set.id, { weight: 115, reps: 8 });
  let sets = await App.queries.getSetsForWorkoutExercise(we.id);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].weight, 115);

  await App.commands.updateSet(set.id, { weight: 120 });
  sets = await App.queries.getSetsForWorkoutExercise(we.id);
  assert.equal(sets[0].weight, 120);
  assert.equal(sets[0].reps, 8, 'unrelated fields are untouched by a partial update');

  await App.commands.deleteSet(set.id);
  sets = await App.queries.getSetsForWorkoutExercise(we.id);
  assert.equal(sets.length, 0);
});

test('finishing a workout marks it completed with an end time', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);

  await App.commands.finishWorkout(workout.id);
  const finished = await App.queries.getWorkout(workout.id);
  assert.equal(finished.status, 'completed');
  assert.ok(finished.endedAt);
  assert.equal(await App.queries.getActiveWorkout(), null);
});

test('cancelling a workout cascades to its exercises and sets', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const workout = await App.commands.createWorkout('Upper', [bench.id]);
  const [we] = await App.queries.getWorkoutExercises(workout.id);
  await App.commands.addEmptySet(we);

  await App.commands.cancelWorkout(workout.id);

  assert.equal(await App.queries.getWorkout(workout.id), undefined);
  assert.deepEqual(await App.queries.getWorkoutExercises(workout.id), []);
  assert.deepEqual(await App.queries.getSetsForWorkoutExercise(we.id), []);
});

test('removing one exercise from a workout deletes only its own sets', async () => {
  const App = freshApp();
  const bench = await seedExercise(App, 'Bench Press');
  const row = await seedExercise(App, 'Barbell Row');
  const workout = await App.commands.createWorkout('Upper', [bench.id, row.id]);
  const [weBench, weRow] = await App.queries.getWorkoutExercises(workout.id);
  await App.commands.addEmptySet(weBench);
  await App.commands.addEmptySet(weRow);

  await App.commands.removeExerciseFromWorkout(weBench.id);

  const remaining = await App.queries.getWorkoutExercises(workout.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, weRow.id);
  assert.equal((await App.queries.getSetsForWorkoutExercise(weRow.id)).length, 1);
});
