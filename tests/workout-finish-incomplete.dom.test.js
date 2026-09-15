const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Finishing with incomplete sets warns first, and respects Cancel vs Confirm', async () => {
  const { document } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);

  // Leave the set blank/incomplete.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  assert.ok(document.querySelector('.set-row').classList.contains('set-row-planned'));

  // Cancel path: confirm() returns false — must stay on the workout,
  // nothing should be finished or deleted.
  let confirmMessage = null;
  global.confirm = (msg) => { confirmMessage = msg; return false; };
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  assert.match(confirmMessage, /1 incomplete set/i, 'should warn with the incomplete count');
  assert.match(document.location.hash, /^#\/workout\//, 'canceling the warning must not navigate away');
  assert.ok(document.getElementById('finish-workout-btn'), 'the workout must still be open/active');
  assert.equal(document.querySelectorAll('.set-row').length, 1, 'nothing should have been discarded');

  // Confirm path: confirm() returns true — the workout actually finishes.
  global.confirm = () => true;
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  assert.equal(document.location.hash, '#/today');
});

test('Finishing with zero incomplete sets does not prompt at all', async () => {
  const { document, App } = await bootRealApp();

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

  let confirmCalled = false;
  global.confirm = () => { confirmCalled = true; return true; };
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  assert.equal(confirmCalled, false, 'no confirmation prompt needed when nothing is incomplete');
  assert.equal(document.location.hash, '#/today');

  const workouts = await App.queries.getAllCompletedWorkouts();
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].status, 'completed');
});

test('Finishing an empty workout (no sets at all) does not prompt', async () => {
  const { document } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);

  let confirmCalled = false;
  global.confirm = () => { confirmCalled = true; return true; };
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  assert.equal(confirmCalled, false);
  assert.equal(document.location.hash, '#/today');
});
