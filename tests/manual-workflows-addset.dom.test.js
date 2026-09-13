const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, reopenRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Add Set QA: copies previous values, requires explicit confirm, editing also works', async () => {
  const { document } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);

  // Set 1: type it in and complete it normally.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '155');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350);
  let rows = document.querySelectorAll('.set-row');
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].classList.contains('set-row-planned'));

  // Set 2: Add Set should copy 155x8, but NOT mark it completed.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  rows = document.querySelectorAll('.set-row');
  assert.equal(rows.length, 2);
  const row2 = rows[1];
  assert.equal(row2.querySelector('.set-weight').value, '155', 'weight should be copied');
  assert.equal(row2.querySelector('.set-reps').value, '8', 'reps should be copied');
  assert.ok(row2.classList.contains('set-row-planned'), 'copied set must not be auto-completed');
  const checkBtn = row2.querySelector('[data-set-check]');
  assert.ok(!checkBtn.disabled, 'check button should be enabled since values are present');
  assert.equal(checkBtn.textContent, '', 'no checkmark yet — unconfirmed');

  // Confirm it via the check button, without retyping anything.
  click(checkBtn);
  await wait(30);
  assert.ok(!row2.classList.contains('set-row-planned'), 'tapping confirm should complete the set');
  assert.equal(row2.querySelector('.set-check').textContent, '✓');

  // Set 3: should copy from set 2 (now valid) since it's the most recent.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  rows = document.querySelectorAll('.set-row');
  const row3 = rows[2];
  assert.equal(row3.querySelector('.set-weight').value, '155');
  assert.equal(row3.querySelector('.set-reps').value, '8');

  // Modify the copied value on set 3 — this should auto-complete it (an
  // explicit edit counts as recording the set), no need to tap confirm.
  setValue(row3.querySelector('.set-weight'), '160');
  await wait(350);
  assert.ok(!row3.classList.contains('set-row-planned'), 'editing a copied value should complete it directly');

  // Persist across reload.
  const workoutId = document.location.hash.replace('#/workout/', '');
  const reopened = await reopenRealApp();
  const sets = await reopened.App.queries.getSetsForWorkout(workoutId);
  assert.equal(sets.length, 3);
  assert.equal(sets[2].weight, 160);
  assert.ok(sets[2].completedAt);
  assert.ok(sets[1].completedAt, 'the confirmed set 2 stays completed after reload');
});
