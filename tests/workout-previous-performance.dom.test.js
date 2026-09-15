const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Workout UX: previous performance shows as a reference line and is never copied into a fresh set', async () => {
  const { document } = await bootRealApp();

  // First workout: log and complete two Bench Press sets, finish.
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '135');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350);
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  const rows1 = document.querySelectorAll('.set-row');
  setValue(rows1[1].querySelector('.set-weight'), '135');
  setValue(rows1[1].querySelector('.set-reps'), '6');
  await wait(350);
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  // Second workout, same exercise — a "Previous" reference should appear.
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

  const previousLine = document.querySelector('.exercise-previous');
  assert.ok(previousLine, 'a "Previous" reference should appear once history exists for this exercise');
  assert.match(previousLine.textContent, /135×8/);
  assert.match(previousLine.textContent, /135×6/);

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
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);

  assert.equal(document.querySelector('.exercise-previous'), null, 'nothing to reference yet on a brand new exercise');
});
