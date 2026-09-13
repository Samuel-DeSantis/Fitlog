const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Picker QA: search finds an exercise regardless of the active muscle chip', async () => {
  const { document } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(30);

  const chips = document.querySelectorAll('.muscle-chip');
  assert.ok(chips.length >= 7, 'All + 6 muscle-group chips should be present');
  assert.ok(document.querySelector('.muscle-chip[data-category="All"]').classList.contains('muscle-chip-active'));

  setValue(document.querySelector('.modal-search'), 'Face Pull');
  await wait(20);
  const items = document.querySelectorAll('.modal-list-item');
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /Face Pull/);
});

test('Picker QA: muscle-group chip filters results, combined with search', async () => {
  const { document } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(30);

  click(document.querySelector('.muscle-chip[data-category="Legs"]'));
  await wait(20);
  let items = Array.from(document.querySelectorAll('.modal-list-item')).map(b => b.textContent);
  assert.ok(items.some(t => /Squat/.test(t)), 'Squat should appear under Legs');
  assert.ok(!items.some(t => /Bench Press/.test(t)), 'Bench Press should not appear under Legs');

  setValue(document.querySelector('.modal-search'), 'press');
  await wait(20);
  items = Array.from(document.querySelectorAll('.modal-list-item')).map(b => b.textContent);
  assert.ok(items.some(t => /Leg Press/.test(t)));
  assert.ok(!items.some(t => /Squat/.test(t)), '"press" search should exclude Squat even though it matches the Legs chip');
});

test('Picker QA: a "Recently Used" section appears after logging an exercise, and disappears once searching', async () => {
  const { document } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(30);
  setValue(document.querySelector('.modal-search'), 'Bench Press');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '135');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350);
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  document.location.hash = '/train';
  await wait(30);
  click(document.getElementById('new-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(30);
  const labels = Array.from(document.querySelectorAll('.modal-list-section-label')).map(l => l.textContent);
  assert.ok(labels.includes('Recently Used'), 'Recently Used section should appear when browsing');
  const recentSection = document.querySelector('.modal-list-section-label');
  assert.equal(recentSection.textContent, 'Recently Used');
  assert.match(recentSection.nextElementSibling.textContent, /Bench Press/, 'Bench Press should be the first recent item');

  setValue(document.querySelector('.modal-search'), 'Squat');
  await wait(20);
  assert.equal(document.querySelectorAll('.modal-list-section-label').length, 0, 'section labels only apply to the default browse state');
});

test('Picker QA: archived exercises never appear in the picker', async () => {
  const { document, App } = await bootRealApp();
  const exercises = await App.queries.getExercises();
  const toArchive = exercises.find(e => e.name === 'Plank');
  await App.commands.archiveExercise(toArchive.id);

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  click(document.getElementById('add-exercise-btn'));
  await wait(30);

  const names = Array.from(document.querySelectorAll('.modal-list-item')).map(b => b.textContent);
  assert.ok(!names.some(n => /Plank/.test(n)), 'archived exercise must not appear in the picker');
});
