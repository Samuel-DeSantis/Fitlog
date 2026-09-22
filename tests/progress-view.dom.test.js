const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

async function openProgress(document) {
  document.location.hash = '/progress';
  await wait(30);
}

test('Progress: empty state when no exercise has any completed history, with a working CTA', async () => {
  const { document } = await bootRealApp();
  await openProgress(document);

  assert.equal(document.querySelector('#progress-exercise-select'), null);
  assert.ok(document.querySelector('.empty-hint'));
  assert.match(document.querySelector('.empty-hint').textContent, /Complete a workout/i);

  click(document.getElementById('progress-log-workout-btn'));
  await wait(30);
  assert.match(document.location.hash, /^#\/workout\//, 'the empty-state CTA starts a workout, same as Today\'s');
});

test('Progress: shows the exercise selector, correct Summary stats, and a History row per completed workout', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');

  const w1 = await App.commands.createWorkout({ title: 'Day 1', date: '2026-01-01', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(w1.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ title: 'Day 2', date: '2026-01-08', exerciseIds: [bench.id] });
  const s2a = await App.commands.addSet(w2.id, bench.id);
  await App.commands.updateSet(s2a.id, { weight: 155, reps: 5 });
  const s2b = await App.commands.addSet(w2.id, bench.id);
  await App.commands.updateSet(s2b.id, { weight: 155, reps: 5 });
  await App.commands.finishWorkout(w2.id);

  await openProgress(document);

  const select = document.getElementById('progress-exercise-select');
  assert.ok(select, 'the exercise selector should be present');
  assert.equal(select.options.length, 1);
  assert.equal(select.options[0].value, bench.id);
  assert.equal(select.options[0].textContent, 'Bench Press');

  const stats = document.querySelectorAll('.progress-stat-value');
  assert.equal(stats[0].textContent, '155', 'Best Weight');
  assert.equal(stats[1].textContent, '8', 'Best Reps (from the 8-rep set, even though it was lighter)');
  assert.equal(stats[2].textContent, (135 * 8 + 155 * 5 * 2).toLocaleString(), 'Total Volume');

  const historyRows = document.querySelectorAll('.progress-history-row');
  assert.equal(historyRows.length, 2, 'one row per completed workout');
  assert.match(historyRows[0].querySelector('.progress-history-sets').textContent, /155.*5.*5/, 'newest workout first');
  assert.match(historyRows[1].querySelector('.progress-history-sets').textContent, /135.*8/);

  // Charts rendered as inline SVG, no library.
  const charts = document.querySelectorAll('.progress-chart-svg');
  assert.equal(charts.length, 2, 'best-weight-over-time and volume-over-time');
});

test('Progress: exercise selector only lists exercises with completed history; archived exercises with history still appear', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const curl = await App.commands.createExercise('Barbell Curl'); // never trained
  const oldLift = await App.commands.createExercise('Old Machine');

  const w1 = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id, oldLift.id] });
  await App.commands.updateSet((await App.commands.addSet(w1.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.updateSet((await App.commands.addSet(w1.id, oldLift.id)).id, { weight: 90, reps: 10 });
  await App.commands.finishWorkout(w1.id);
  await App.commands.archiveExercise(oldLift.id);

  await openProgress(document);
  const select = document.getElementById('progress-exercise-select');
  const names = [...select.options].map(o => o.textContent).sort();
  assert.deepEqual(names, ['Bench Press', 'Old Machine']);
  assert.equal(names.includes('Barbell Curl'), false, 'never-trained exercise is excluded');
});

test('Progress: switching the exercise selector updates Summary, Charts, and History', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');

  const w1 = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(w1.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(w1.id);

  const w2 = await App.commands.createWorkout({ title: 'Day 2', exerciseIds: [row.id] });
  await App.commands.updateSet((await App.commands.addSet(w2.id, row.id)).id, { weight: 95, reps: 10 });
  await App.commands.finishWorkout(w2.id);

  await openProgress(document);
  const select = document.getElementById('progress-exercise-select');
  // Alphabetical default: Barbell Row before Bench Press.
  assert.equal(select.value, row.id);
  assert.equal(document.querySelectorAll('.progress-stat-value')[0].textContent, '95');

  setValue(select, bench.id);
  await wait(20);
  assert.equal(document.querySelectorAll('.progress-stat-value')[0].textContent, '135');
  assert.equal(document.querySelectorAll('.progress-history-row').length, 1);
  assert.match(document.querySelector('.progress-history-sets').textContent, /135.*8/);
});

test('Progress: a History row navigates to that Workout', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(workout.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  await openProgress(document);
  click(document.querySelector('.progress-history-row'));
  await wait(30);
  assert.equal(document.location.hash, '#/workout/' + workout.id);
});

test('Progress: a single data point renders a valid one-point chart and summary without errors', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const workout = await App.commands.createWorkout({ title: 'Day 1', date: '2026-03-01', exerciseIds: [bench.id] });
  await App.commands.updateSet((await App.commands.addSet(workout.id, bench.id)).id, { weight: 135, reps: 8 });
  await App.commands.finishWorkout(workout.id);

  await openProgress(document);
  const charts = document.querySelectorAll('.progress-chart-svg');
  assert.equal(charts.length, 2);
  charts.forEach((svg) => {
    assert.equal(svg.querySelectorAll('circle').length, 1, 'a single point renders as one dot, no line');
    assert.equal(svg.querySelectorAll('path').length, 0, 'no line path with fewer than two points');
  });
  assert.equal(document.querySelectorAll('.progress-history-row').length, 1);
});

test('Progress: blank prescribed sets and unconfirmed sets never appear in the History list or Summary stats', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper', [{ exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }]);
  const workout = await App.commands.startFromSession(session);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  await App.commands.updateSet(sets[0].id, { weight: 135, reps: 8 });
  // sets[1], sets[2] remain blank prescribed sets.
  await App.commands.addSet(workout.id, bench.id); // copies forward but stays unconfirmed
  await App.commands.finishWorkout(workout.id);

  await openProgress(document);
  assert.equal(document.querySelectorAll('.progress-history-row').length, 1, 'only the one confirmed set produced a history entry');
  assert.equal(document.querySelectorAll('.progress-stat-value')[2].textContent, (135 * 8).toLocaleString(), 'volume counts only the confirmed set');
});
