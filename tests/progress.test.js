const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

// ---------------------------------------------------------------------
// 1, 2, 3. Only genuinely completed sets count — blank prescribed sets
// and unconfirmed (copied-but-not-confirmed) sets are excluded.
// ---------------------------------------------------------------------

test('1,2,3. Progress history includes only confirmed-completed sets — excludes blank prescribed sets and unconfirmed copied values', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper', [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);

  // Confirm the first prescribed set; leave the other two blank; add a
  // 4th that copies forward but is left unconfirmed.
  await App.commands.updateSet(sets[0].id, { weight: 135, reps: 8 });
  const extra = await App.commands.addSet(workout.id, bench.id);
  assert.equal(App.commands.isSetCompleted(extra), false, 'sanity: the copied set is genuinely unconfirmed');
  await App.commands.finishWorkout(workout.id);

  const history = await App.progress.getCompletedHistory(bench.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].sets.length, 1, 'only the one explicitly confirmed set counts');
  assert.equal(history[0].sets[0].weight, 135);
  assert.equal(history[0].sets[0].reps, 8);
});

test('4. Planned (never-started) and still-active workouts contribute nothing to Progress', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper', [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
  await App.commands.planCalendarEntry('2026-05-01', session.id); // never started

  let history = await App.progress.getCompletedHistory(bench.id);
  assert.equal(history.length, 0);
  let summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.hasHistory, false);

  // A still-active workout, even with an individually-confirmed set,
  // does not count until the workout itself is finished (matches
  // queries.getExerciseHistory's existing status==='completed' filter).
  const workout = await App.commands.createWorkout({ title: 'X', exerciseIds: [bench.id] });
  const s = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s.id, { weight: 200, reps: 5 });
  history = await App.progress.getCompletedHistory(bench.id);
  assert.equal(history.length, 0, 'not counted until the workout is finished');

  await App.commands.finishWorkout(workout.id);
  history = await App.progress.getCompletedHistory(bench.id);
  assert.equal(history.length, 1, 'counts as soon as the workout is finished');
});

// ---------------------------------------------------------------------
// 5, 6, 7. Best weight, best reps, and total volume calculate correctly.
// ---------------------------------------------------------------------

test('5. Best weight is the highest completed weight, ignoring incomplete sets', () => {
  const App = freshApp();
  const history = [
    { workout: { date: '2026-01-03' }, sets: [{ weight: 185, reps: 3 }, { weight: 175, reps: 5 }] },
    { workout: { date: '2026-01-01' }, sets: [{ weight: 135, reps: 8 }] }
  ];
  assert.equal(App.progress.bestWeight(history), 185);
  assert.equal(App.progress.bestWeight([]), null, 'no history -> null, not zero');
});

test('6. Best reps is the highest completed rep count for any single set', () => {
  const App = freshApp();
  const history = [
    { workout: { date: '2026-01-03' }, sets: [{ weight: 95, reps: 12 }, { weight: 185, reps: 3 }] },
    { workout: { date: '2026-01-01' }, sets: [{ weight: 135, reps: 8 }] }
  ];
  assert.equal(App.progress.bestReps(history), 12, 'the highest rep set, even though it is not the heaviest weight');
  assert.equal(App.progress.bestReps([]), null);
});

test('bestRepsAtWeight narrows to sets performed at exactly the given weight', () => {
  const App = freshApp();
  const history = [
    { workout: { date: '2026-01-03' }, sets: [{ weight: 135, reps: 10 }, { weight: 185, reps: 3 }] },
    { workout: { date: '2026-01-01' }, sets: [{ weight: 135, reps: 8 }] }
  ];
  assert.equal(App.progress.bestRepsAtWeight(history, 135), 10);
  assert.equal(App.progress.bestRepsAtWeight(history, 225), null, 'never performed at this weight');
});

test('7. Total volume sums weight x reps across every completed set, never counting a prescription', () => {
  const App = freshApp();
  const history = [
    { workout: { date: '2026-01-03' }, sets: [{ weight: 185, reps: 3 }, { weight: 175, reps: 5 }] }, // 555 + 875
    { workout: { date: '2026-01-01' }, sets: [{ weight: 135, reps: 8 }] } // 1080
  ];
  assert.equal(App.progress.totalVolume(history), 555 + 875 + 1080);
  assert.equal(App.progress.totalVolume([]), 0);
});

// ---------------------------------------------------------------------
// 8. Multiple workouts for the same exercise are all correctly included
// and aggregated.
// ---------------------------------------------------------------------

test('8. Multiple workouts on the same exercise are all reflected in the summary, newest first', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');

  const w1 = await App.commands.createWorkout({ title: 'Day 1', date: '2026-01-01', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(w1.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ title: 'Day 2', date: '2026-01-08', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(w2.id, bench.id)).id, { weight: 145, reps: 6 });
  await App.commands.finishWorkout(w2.id);

  const w3 = await App.commands.createWorkout({ title: 'Day 3', date: '2026-01-15', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(w3.id, bench.id)).id, { weight: 155, reps: 4 });
  await App.commands.finishWorkout(w3.id);

  const summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.history.length, 3);
  assert.deepEqual(summary.history.map(h => h.workout.date), ['2026-01-15', '2026-01-08', '2026-01-01'], 'newest first');
  assert.equal(summary.bestWeight, 155);
  assert.equal(summary.bestReps, 8);
  assert.equal(summary.totalVolume, 135 * 8 + 145 * 6 + 155 * 4);
  assert.equal(summary.mostRecent.workout.date, '2026-01-15');
});

// ---------------------------------------------------------------------
// 9. Editing historical Workout data changes derived Progress — Progress
// is a live read of actual performance, not a frozen snapshot.
// ---------------------------------------------------------------------

test('9. Editing an old (completed) Workout changes derived Progress', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  const set = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(set.id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  let summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.bestWeight, 135);
  assert.equal(summary.totalVolume, 135 * 8);

  // Historically edit the now-completed workout's set.
  await App.commands.updateSet(set.id, { weight: 175, reps: 5 });
  summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.bestWeight, 175, 'the edit is reflected immediately');
  assert.equal(summary.totalVolume, 175 * 5);

  // Adding another set to that historical workout is reflected too.
  const extra = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(extra.id, { weight: 185, reps: 2 });
  summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.bestWeight, 185);
  assert.equal(summary.totalVolume, 175 * 5 + 185 * 2);
});

// ---------------------------------------------------------------------
// 10. Changing a Session's prescription never changes historical
// Progress — Progress never reads Session data at all.
// ---------------------------------------------------------------------

test('10. Changing a Session prescription after the fact does not change historical Progress', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper', [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(sets[0].id, { weight: 175, reps: 5 });
  await App.commands.updateSet(sets[1].id, { weight: 175, reps: 5 });
  await App.commands.updateSet(sets[2].id, { weight: 175, reps: 5 });
  await App.commands.finishWorkout(workout.id);

  const before = await App.progress.getExerciseSummary(bench.id);

  await App.commands.updateSessionExercisePrescription(session.id, bench.id, { targetSets: 10, repMin: 1, repMax: 20 });

  const after = await App.progress.getExerciseSummary(bench.id);
  assert.deepEqual(after, before, "Progress is byte-for-byte unaffected by a Session prescription change");
});

// ---------------------------------------------------------------------
// 11. Archived exercises with history remain queryable and appear in
// the exercise-picker list.
// ---------------------------------------------------------------------

test('11. An archived exercise with completed history still appears in getExercisesWithHistory and stays queryable', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(workout.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  await App.commands.archiveExercise(bench.id);

  const withHistory = await App.progress.getExercisesWithHistory();
  assert.ok(withHistory.some(e => e.id === bench.id), 'the archived exercise still appears since it has real history');

  const summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.hasHistory, true);
  assert.equal(summary.bestWeight, 135);
});

test('An archived exercise with NO history is correctly excluded from getExercisesWithHistory', async () => {
  const App = freshApp();
  const curl = await App.commands.createExercise('Barbell Curl');
  await App.commands.archiveExercise(curl.id);

  const withHistory = await App.progress.getExercisesWithHistory();
  assert.equal(withHistory.some(e => e.id === curl.id), false);
});

// ---------------------------------------------------------------------
// 12. An exercise with no history produces an appropriate empty state,
// not an error.
// ---------------------------------------------------------------------

test('12. An exercise with no completed history produces a clean empty state', async () => {
  const App = freshApp();
  const curl = await App.commands.createExercise('Barbell Curl');

  const summary = await App.progress.getExerciseSummary(curl.id);
  assert.equal(summary.hasHistory, false);
  assert.equal(summary.bestWeight, null);
  assert.equal(summary.bestReps, null);
  assert.equal(summary.totalVolume, 0);
  assert.equal(summary.mostRecent, null);
  assert.deepEqual(summary.history, []);
  assert.deepEqual(summary.chartSeries, []);

  const withHistory = await App.progress.getExercisesWithHistory();
  assert.equal(withHistory.some(e => e.id === curl.id), false, 'no history -> excluded from the picker');
});

// ---------------------------------------------------------------------
// 13. A single data point works cleanly for both the summary and the
// chart series — no off-by-one or division-by-zero issues.
// ---------------------------------------------------------------------

test('13. A single completed set/workout produces a valid one-point summary and chart series', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', date: '2026-02-01', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(workout.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  const summary = await App.progress.getExerciseSummary(bench.id);
  assert.equal(summary.hasHistory, true);
  assert.equal(summary.bestWeight, 135);
  assert.equal(summary.bestReps, 8);
  assert.equal(summary.totalVolume, 135 * 8);
  assert.equal(summary.history.length, 1);
  assert.equal(summary.chartSeries.length, 1);
  assert.deepEqual(summary.chartSeries[0], { date: '2026-02-01', bestWeight: 135, volume: 135 * 8 });
});

// ---------------------------------------------------------------------
// 14. Export/import preserves whatever Progress derives from the data —
// Progress itself has nothing of its own to export, since it computes
// everything fresh from Workouts/Sets.
// ---------------------------------------------------------------------

test('14. Export -> import preserves Progress-derived results exactly', async () => {
  const App1 = freshApp();
  const bench = await App1.commands.createExercise('Bench Press');
  const w1 = await App1.commands.createWorkout({ title: 'Day 1', date: '2026-01-01', exerciseIds: [bench.id] });
  await App1.commands.updateSet((await App1.commands.addSet(w1.id, bench.id)).id, { weight: 135, reps: 8 });
  await App1.commands.finishWorkout(w1.id);
  const w2 = await App1.commands.createWorkout({ title: 'Day 2', date: '2026-01-08', exerciseIds: [bench.id] });
  await App1.commands.updateSet((await App1.commands.addSet(w2.id, bench.id)).id, { weight: 145, reps: 6 });
  await App1.commands.finishWorkout(w2.id);

  const before = await App1.progress.getExerciseSummary(bench.id);
  const backup = await App1.db.exportAll();

  const App2 = freshApp();
  await App2.db.importAll(backup, 'replace');
  const after = await App2.progress.getExerciseSummary(bench.id);

  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------
// Data-integrity guard: Progress is read-only — calling any of its
// functions must never write anything.
// ---------------------------------------------------------------------

test('Progress functions never write to the database', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(workout.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  const beforeWorkout = await App.queries.getWorkout(workout.id);
  const beforeSets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  const beforeExercises = await App.queries.getExercises(true);

  await App.progress.getExerciseSummary(bench.id);
  await App.progress.getExercisesWithHistory();

  assert.deepEqual(await App.queries.getWorkout(workout.id), beforeWorkout);
  assert.deepEqual(await App.queries.getSetsForWorkoutExercise(workout.id, bench.id), beforeSets);
  assert.deepEqual(await App.queries.getExercises(true), beforeExercises);
});
