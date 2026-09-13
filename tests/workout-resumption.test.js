const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, reopenApp } = require('./helpers/setup');

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

test('TRUE concurrency: many simultaneous startWorkout calls produce exactly one workout, atomically', async () => {
  const App = freshApp();
  // 10 concurrent "double taps" — the old check-then-act pattern could let
  // several of these see "no active workout" before any write landed. The
  // atomic transaction in resolveActiveWorkout must serialize all of them.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => App.commands.startWorkout('Workout', []))
  );
  const uniqueIds = new Set(results.map(w => w.id));
  assert.equal(uniqueIds.size, 1, 'every concurrent call must resolve to the SAME workout');

  const activeRows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(activeRows.length, 1, 'no duplicates should ever be written, not even transiently');
});

test('finishing the active workout allows an explicit second workout the same day', async () => {
  const App = freshApp();
  const w1 = await App.commands.startWorkout('Morning', []);
  await App.commands.finishWorkout(w1.id);
  const w2 = await App.commands.startWorkout('Evening', []);
  assert.notEqual(w2.id, w1.id);
});

test('a corrupted state with two active workouts is surfaced explicitly, never silently repaired', async () => {
  const App = freshApp();
  // Simulate corrupted/pre-fix imported data directly — bypassing the
  // guarded commands entirely, the only way this state can occur now.
  await App.db.put('workouts', { id: 'w1', title: 'A', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: '2026-01-01T09:00:00.000Z', endedAt: null, createdAt: '', updatedAt: '' });
  await App.db.put('workouts', { id: 'w2', title: 'B', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: '2026-01-01T10:00:00.000Z', endedAt: null, createdAt: '', updatedAt: '' });

  await assert.rejects(
    () => App.queries.getActiveWorkout(),
    (err) => err instanceof App.errors.MultipleActiveWorkoutsError && err.workouts.length === 2
  );

  // Nothing was changed by merely detecting the conflict.
  const w1 = await App.queries.getWorkout('w1');
  const w2 = await App.queries.getWorkout('w2');
  assert.equal(w1.status, 'active');
  assert.equal(w2.status, 'active');
});

test('startWorkout also refuses to silently resolve a corrupted multi-active state', async () => {
  const App = freshApp();
  await App.db.put('workouts', { id: 'w1', title: 'A', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: 'a', endedAt: null, createdAt: '', updatedAt: '' });
  await App.db.put('workouts', { id: 'w2', title: 'B', date: '2026-01-01', status: 'active', exerciseOrder: [], startedAt: 'b', endedAt: null, createdAt: '', updatedAt: '' });

  await assert.rejects(() => App.commands.startWorkout('Workout', []), App.errors.MultipleActiveWorkoutsError);
  // Still both there, still both active — no auto-repair happened.
  const rows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(rows.length, 2);
});

test('active and completed workouts survive a simulated app reload', async () => {
  let App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const active = await App.commands.startWorkout('Reload Test', [bench.id]);
  const set = await App.commands.addSet(active.id, bench.id);
  await App.commands.updateSet(set.id, { weight: 135, reps: 8 });

  const w1 = await App.commands.createWorkout({ title: 'Done Earlier', exerciseIds: [] });
  await App.commands.finishWorkout(w1.id);

  // Simulate closing and reopening the app: same underlying data, fresh JS.
  App = reopenApp();

  const stillActive = await App.queries.getActiveWorkout();
  assert.equal(stillActive.id, active.id);
  const stillSet = await App.queries.getSetsForWorkoutExercise(active.id, bench.id);
  assert.equal(stillSet[0].weight, 135);

  const completed = await App.queries.getWorkout(w1.id);
  assert.equal(completed.status, 'completed');
});
