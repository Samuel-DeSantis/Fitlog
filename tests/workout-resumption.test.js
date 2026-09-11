const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('startWorkout is idempotent: a second call resumes, never duplicates', async () => {
  const App = freshApp();
  const first = await App.commands.startWorkout('Workout', []);
  const second = await App.commands.startWorkout('Workout', []);
  assert.equal(second.id, first.id);
  const active = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(active.length, 1);
});

test('repeatLastWorkout and startFromSession also resume rather than duplicate an active workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  await App.commands.finishWorkout(w1.id);

  const active = await App.commands.startWorkout('Workout', [bench.id]);
  const viaRepeat = await App.commands.repeatLastWorkout();
  const viaSession = await App.commands.startFromSession({ name: 'X', exercises: [bench.id] });

  assert.equal(viaRepeat.id, active.id);
  assert.equal(viaSession.id, active.id);
  const activeRows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(activeRows.length, 1);
});

test('repeatLastWorkout copies exercise structure but zero completed sets', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const w1 = await App.commands.createWorkout({ title: 'Upper A', exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.repeatLastWorkout();
  assert.notEqual(w2.id, w1.id);
  assert.deepEqual(w2.exerciseOrder, [bench.id]);
  const sets2 = await App.queries.getSetsForWorkoutExercise(w2.id, bench.id);
  assert.equal(sets2.length, 0, 'repeat must not pre-fill historical numbers');
});

test('a simulated concurrent double-tap still yields exactly one active workout after consolidation', async () => {
  const App = freshApp();
  await Promise.all([
    App.commands.startWorkout('Workout', []),
    App.commands.startWorkout('Workout', [])
  ]);
  let active = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  if (active.length > 1) {
    const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
    assert.equal(resolvedCount, active.length - 1);
  }
  active = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(active.length, 1);
});

test('consolidateActiveWorkouts keeps the newest active and preserves sets on the rest', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  const w1 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s1 = await App.commands.addSet(w1.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 100, reps: 10 });

  await new Promise(r => setTimeout(r, 5));
  const w2 = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  const s2 = await App.commands.addSet(w2.id, bench.id);
  await App.commands.updateSet(s2.id, { weight: 115, reps: 8 });

  const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
  assert.equal(resolvedCount, 1);

  const stillActive = await App.queries.getActiveWorkout();
  assert.equal(stillActive.id, w2.id);

  const w1After = await App.queries.getWorkout(w1.id);
  assert.equal(w1After.status, 'completed');
  assert.equal((await App.queries.getSetsForWorkoutExercise(w1.id, bench.id))[0].weight, 100, 'set is preserved, not deleted');
});

test('finishing the active workout allows an explicit second workout the same day', async () => {
  const App = freshApp();
  const w1 = await App.commands.startWorkout('Morning', []);
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.startWorkout('Evening', []);
  assert.notEqual(w2.id, w1.id, 'finishing clears the active slot so a second explicit workout is allowed');
});
