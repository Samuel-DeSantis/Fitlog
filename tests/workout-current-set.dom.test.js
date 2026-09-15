const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Workout UX: the "current" set is always the earliest incomplete one, and updates as sets change', async () => {
  const { document } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);

  const block = document.querySelector('.exercise-block');

  // Set 1: added blank — it's the only set, so it must be current.
  click(block.querySelector('.btn-add-set'));
  await wait(30);
  let rows = block.querySelectorAll('.set-row');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].classList.contains('set-row-current'), 'the only (incomplete) set should be current');

  // Complete set 1 by typing both values — it should stop being current,
  // and since it's now the only set, nothing else should claim it either.
  setValue(rows[0].querySelector('.set-weight'), '135');
  setValue(rows[0].querySelector('.set-reps'), '8');
  await wait(350);
  assert.ok(!rows[0].classList.contains('set-row-current'), 'a completed set is never "current"');
  assert.ok(!rows[0].classList.contains('set-row-planned'));

  // Set 2: copies set 1's values but isn't confirmed — it becomes current.
  click(block.querySelector('.btn-add-set'));
  await wait(30);
  rows = block.querySelectorAll('.set-row');
  assert.equal(rows.length, 2);
  assert.ok(!rows[0].classList.contains('set-row-current'), 'set 1 stays done, not current');
  assert.ok(rows[1].classList.contains('set-row-current'), 'the new unconfirmed set becomes current');

  // Confirm set 2 via its check button — nothing left incomplete.
  click(rows[1].querySelector('[data-set-check]'));
  await wait(30);
  assert.ok(!rows[1].classList.contains('set-row-current'), 'confirming a set clears its current highlight');

  // Set 3: added blank — becomes current.
  click(block.querySelector('.btn-add-set'));
  await wait(30);
  rows = block.querySelectorAll('.set-row');
  assert.equal(rows.length, 3);
  assert.ok(rows[2].classList.contains('set-row-current'));

  // Set 4: added while set 3 is still incomplete/unconfirmed — set 3 is
  // still the earliest incomplete set, so set 4 must NOT steal "current".
  click(block.querySelector('.btn-add-set'));
  await wait(30);
  rows = block.querySelectorAll('.set-row');
  assert.equal(rows.length, 4);
  assert.ok(rows[2].classList.contains('set-row-current'), 'the earliest incomplete set stays current');
  assert.ok(!rows[3].classList.contains('set-row-current'), 'a later incomplete set is not current while an earlier one is still open');

  // Remove set 3 (the current one) — set 4 (now at index 2) should be
  // promoted to current.
  click(rows[2].querySelector('.set-remove'));
  await wait(30);
  rows = block.querySelectorAll('.set-row');
  assert.equal(rows.length, 3);
  assert.ok(rows[2].classList.contains('set-row-current'), 'removing the current set promotes the next incomplete one');
});
