const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

async function setupWorkout(App) {
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id] });
  return { bench, workout };
}

test('1. Add Set with a completed previous set copies its weight/reps', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });

  const s2 = await App.commands.addSet(workout.id, bench.id);
  assert.equal(s2.weight, 155);
  assert.equal(s2.reps, 8);
});

test('2. The copied set is NOT automatically completed', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });

  const s2 = await App.commands.addSet(workout.id, bench.id);
  assert.equal(s2.completedAt, null);
  assert.equal(App.commands.isSetCompleted(s2), false, 'has values but is not completed');
});

test('3. If the immediately preceding set is incomplete, look backward for the most recent valid set', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 }); // valid
  const s2 = await App.commands.addSet(workout.id, bench.id); // copies from s1, unconfirmed

  // Make s2 genuinely incomplete: clear its reps.
  await App.commands.updateSet(s2.id, { reps: null });
  const s2After = await App.db.get('sets', s2.id);
  assert.equal(s2After.reps, null);

  const s3 = await App.commands.addSet(workout.id, bench.id);
  assert.equal(s3.weight, 155, 'should skip incomplete s2 and copy from valid s1');
  assert.equal(s3.reps, 8);
});

test('4. No previous valid set anywhere in this exercise -> new set is blank', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  await App.commands.addSet(workout.id, bench.id); // blank
  const s2 = await App.commands.addSet(workout.id, bench.id); // s1 has no values either

  assert.equal(s2.weight, null);
  assert.equal(s2.reps, null);
});

test('5. Editing the copied values works normally, including completing it', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });
  const s2 = await App.commands.addSet(workout.id, bench.id);

  // User changes the copied weight — this is an explicit action and
  // should complete the set per the normal rule (both fields present).
  const edited = await App.commands.updateSet(s2.id, { weight: 160 });
  assert.equal(edited.weight, 160);
  assert.equal(edited.reps, 8, 'untouched copied field remains');
  assert.ok(App.commands.isSetCompleted(edited), 'editing a copied value completes it, same as any other set');
});

test('5b. A copied-but-untouched set can be explicitly confirmed without retyping', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });
  const s2 = await App.commands.addSet(workout.id, bench.id);
  assert.equal(App.commands.isSetCompleted(s2), false);

  const confirmed = await App.commands.setSetCompleted(s2.id, true);
  assert.equal(confirmed.weight, 155, 'confirming does not change the values');
  assert.equal(confirmed.reps, 8);
  assert.ok(App.commands.isSetCompleted(confirmed));

  const unconfirmed = await App.commands.setSetCompleted(s2.id, false);
  assert.equal(App.commands.isSetCompleted(unconfirmed), false, 'can be un-confirmed back to planned');
});

test('setSetCompleted refuses to complete a set missing weight or reps', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const blank = await App.commands.addSet(workout.id, bench.id);
  const result = await App.commands.setSetCompleted(blank.id, true);
  assert.equal(App.commands.isSetCompleted(result), false, 'cannot confirm a set with no values');
});

test('6. Set ordering remains correct across copied sets', async () => {
  const App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });
  const s2 = await App.commands.addSet(workout.id, bench.id);
  const s3 = await App.commands.addSet(workout.id, bench.id);

  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.deepEqual(sets.map(s => s.id), [s1.id, s2.id, s3.id]);
  assert.deepEqual(sets.map(s => s.setOrder), [0, 1, 2]);
});

test('7. Copied sets persist correctly across a simulated reload', async () => {
  const { reopenApp } = require('./helpers/setup');
  let App = freshApp();
  const { bench, workout } = await setupWorkout(App);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 155, reps: 8 });
  await App.commands.addSet(workout.id, bench.id);

  App = reopenApp();
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  assert.equal(sets[1].weight, 155);
  assert.equal(sets[1].reps, 8);
  assert.equal(sets[1].completedAt, null, 'still unconfirmed after reload');
});

test('copying does not reach across exercises within the same workout', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  const workout = await App.commands.createWorkout({ exerciseIds: [bench.id, row.id] });

  const b1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(b1.id, { weight: 155, reps: 8 });

  const r1 = await App.commands.addSet(workout.id, row.id);
  assert.equal(r1.weight, null, "a different exercise's first set must not inherit another exercise's values");
});
