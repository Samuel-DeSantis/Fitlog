const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

async function startBenchWorkoutFromToday(document) {
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
}

async function startBenchWorkoutFromTrain(document) {
  document.location.hash = '/train';
  await wait(30);
  click(document.getElementById('new-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
}

// Logs one completed Bench Press set per {weight, reps} pair given, in
// order, on whatever workout is currently open.
async function logCompletedSets(document, pairs) {
  for (const [weight, reps] of pairs) {
    click(document.querySelector('.btn-add-set'));
    await wait(30);
    const rows = document.querySelectorAll('.set-row');
    const row = rows[rows.length - 1];
    setValue(row.querySelector('.set-weight'), String(weight));
    setValue(row.querySelector('.set-reps'), String(reps));
    await wait(350);
  }
}

test('Workout UX: previous performance shows as a reference line and is never copied into a fresh set', async () => {
  const { document } = await bootRealApp();

  await startBenchWorkoutFromToday(document);
  await logCompletedSets(document, [[135, 8], [135, 6]]);
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  await startBenchWorkoutFromTrain(document);

  const previousLine = document.querySelector('.exercise-previous');
  assert.ok(previousLine, 'a "Previous" reference should appear once history exists for this exercise');
  assert.equal(previousLine.textContent.trim(), 'Previous: 135×8, 6');

  // A freshly-added set in today's workout must stay blank/planned —
  // previous performance is reference only, never silently copied in.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  const newRow = document.querySelector('.set-row');
  assert.equal(newRow.querySelector('.set-weight').value, '', 'previous performance must never be auto-copied into a new set');
  assert.equal(newRow.querySelector('.set-reps').value, '');
  assert.ok(newRow.classList.contains('set-row-planned'));
  assert.ok(newRow.classList.contains('set-row-current'));
});

test('Workout UX: no previous performance line for an exercise with no completed history', async () => {
  const { document } = await bootRealApp();
  await startBenchWorkoutFromToday(document);

  assert.equal(document.querySelector('.exercise-previous'), null, 'nothing to reference yet on a brand new exercise');
});

test('Previous performance formatting: repeated weight is compacted to reps only, a weight change re-states it', async () => {
  const cases = [
    { pairs: [[135, 8], [135, 8], [135, 6]], expected: 'Previous: 135×8, 8, 6' },
    { pairs: [[135, 8], [135, 8], [145, 6], [145, 5]], expected: 'Previous: 135×8, 8, 145×6, 5' },
    { pairs: [[135, 8], [145, 6], [135, 5]], expected: 'Previous: 135×8, 145×6, 135×5' }
  ];

  for (const { pairs, expected } of cases) {
    const { document } = await bootRealApp();
    await startBenchWorkoutFromToday(document);
    await logCompletedSets(document, pairs);
    click(document.getElementById('finish-workout-btn'));
    await wait(30);

    await startBenchWorkoutFromTrain(document);
    const previousLine = document.querySelector('.exercise-previous');
    assert.equal(previousLine.textContent.trim(), expected, `pairs=${JSON.stringify(pairs)}`);
  }
});

test('Previous performance display: an incomplete/unconfirmed leftover set from the previous workout is never shown', async () => {
  const { document } = await bootRealApp();

  await startBenchWorkoutFromToday(document);
  await logCompletedSets(document, [[135, 8]]);

  // Add a second set but leave it unconfirmed (copies 135/8, never typed
  // or checked off), then finish anyway via the incomplete-sets warning.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  global.confirm = () => true;
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  await startBenchWorkoutFromTrain(document);
  const previousLine = document.querySelector('.exercise-previous');
  assert.ok(previousLine, 'the one completed set should still be shown as a reference');
  assert.equal(previousLine.textContent.trim(), 'Previous: 135×8', 'the incomplete/unconfirmed leftover set must not appear');
});
