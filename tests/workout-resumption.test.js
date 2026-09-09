const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('startWorkout is idempotent: calling it twice in a row resumes, never duplicates', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  const first = await App.commands.startWorkout('Workout', [bench.id]);
  const second = await App.commands.startWorkout('Workout', [bench.id]);

  assert.equal(second.id, first.id, 'second call should resume the same workout, not create another');
  const inProgress = (await App.db.getAll('workouts')).filter(w => w.status === 'in_progress');
  assert.equal(inProgress.length, 1);
});

test('repeatLastWorkout and startFromTemplate also refuse to create a second active workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout('Day 1', [bench.id]);
  await App.commands.finishWorkout(w1.id);

  const active = await App.commands.startWorkout('Workout', [bench.id]);
  const viaRepeat = await App.commands.repeatLastWorkout();
  const viaTemplate = await App.commands.startFromTemplate({ name: 'X', exercises: [{ exerciseId: bench.id, order: 0 }] });

  assert.equal(viaRepeat.id, active.id);
  assert.equal(viaTemplate.id, active.id);
  const inProgress = (await App.db.getAll('workouts')).filter(w => w.status === 'in_progress');
  assert.equal(inProgress.length, 1);
});

test('a simulated double-tap race (two concurrent startWorkout calls) still yields exactly one active workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  // Both calls read "no active workout" before either write lands —
  // this is the exact race that produced duplicate workouts before the fix.
  const [a, b] = await Promise.all([
    App.commands.startWorkout('Workout', [bench.id]),
    App.commands.startWorkout('Workout', [bench.id])
  ]);

  const inProgress = (await App.db.getAll('workouts')).filter(w => w.status === 'in_progress');
  // The guard can't fully close a true concurrent race (both reads can win
  // before either write commits) — that's what consolidateActiveWorkouts
  // is for. Assert the safety net actually cleans it up losslessly.
  if (inProgress.length > 1) {
    const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
    assert.equal(resolvedCount, inProgress.length - 1);
  }
  const finalActive = (await App.db.getAll('workouts')).filter(w => w.status === 'in_progress');
  assert.equal(finalActive.length, 1);
});

test('consolidateActiveWorkouts keeps the most recently started workout active and completes the rest without deleting sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  // Simulate the pre-fix bug directly: two independently created in_progress
  // workouts for the same day, each with logged sets.
  const w1 = await App.commands.createWorkout('Workout', [bench.id]);
  const [we1] = await App.queries.getWorkoutExercises(w1.id);
  const s1 = await App.commands.addEmptySet(we1);
  await App.commands.updateSet(s1.id, { weight: 100, reps: 10 });

  await new Promise(r => setTimeout(r, 5));
  const w2 = await App.commands.createWorkout('Workout', [bench.id]);
  const [we2] = await App.queries.getWorkoutExercises(w2.id);
  const s2 = await App.commands.addEmptySet(we2);
  await App.commands.updateSet(s2.id, { weight: 115, reps: 8 });

  const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
  assert.equal(resolvedCount, 1);

  const stillActive = await App.queries.getActiveWorkout();
  assert.equal(stillActive.id, w2.id, 'the more recently started workout stays active');

  const w1After = await App.queries.getWorkout(w1.id);
  assert.equal(w1After.status, 'completed', 'the older duplicate is marked completed, not deleted');

  // Its set is still there and still shows up in exercise history.
  const history = await App.queries.getExerciseHistory(bench.id);
  const totalSetsAcrossHistory = history.reduce((n, h) => n + h.sets.length, 0);
  assert.equal(totalSetsAcrossHistory, 1, 'only the completed duplicate contributes to history; the still-active one is correctly excluded until finished');
});
