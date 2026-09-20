const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, wait } = require('./helpers/domSetup');

test('DOM: starting a Session shows the prescribed number of blank set rows on the workout screen', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Strength', [
    { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }
  ]);

  document.location.hash = '/train';
  await wait(30);
  click(document.querySelector(`[data-start="${session.id}"]`));
  await wait(50);

  assert.match(document.location.hash, /^#\/workout\//, 'starting a Session navigates straight to its new workout');

  const rows = document.querySelectorAll('.set-row');
  assert.equal(rows.length, 3, 'the workout screen shows the 3 prescribed blank rows');
  rows.forEach((row) => {
    assert.equal(row.querySelector('.set-weight').value, '', 'a prescribed set starts blank, not pre-filled');
    assert.equal(row.querySelector('.set-reps').value, '');
    assert.ok(row.classList.contains('set-row-planned'), 'a blank prescribed set is incomplete, same as any other');
  });
  assert.ok(rows[0].classList.contains('set-row-current'), 'the first blank set is highlighted as the current one to fill in');

  // The existing "+ Add Set" flow still works normally on top of the
  // prescribed rows.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  assert.equal(document.querySelectorAll('.set-row').length, 4);
});
