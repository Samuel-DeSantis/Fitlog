const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Calendar QA: month navigation updates the heading', async () => {
  const { document } = await bootRealApp();
  document.location.hash = '/calendar';
  await wait(30);

  const heading = () => document.querySelector('.calendar-month-heading').textContent;
  const initial = heading();

  click(document.getElementById('next-month'));
  await wait(30);
  const afterNext = heading();
  assert.notEqual(afterNext, initial);

  click(document.getElementById('prev-month'));
  await wait(30);
  assert.equal(heading(), initial, 'prev-month should return to the original heading');
});

test('Calendar QA: plan a future Session, see a hollow colored dot, start it, finish it, see it become filled', async () => {
  const { document, App } = await bootRealApp();

  // Create a red "Upper Body" session via Train first.
  document.location.hash = '/train';
  await wait(30);
  click(document.getElementById('create-session-btn'));
  await wait(20);
  setValue(document.querySelector('#session-name'), 'Upper Body');
  document.querySelector('[data-color="red"]').click();
  click(document.getElementById('session-add-exercise'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(20);
  click(document.getElementById('session-save'));
  await wait(30);

  const futureDate = App.utils.daysAgoISO(-6);
  const session = (await App.queries.getSessions())[0];
  await App.commands.planCalendarEntry(futureDate, session.id);

  document.location.hash = '/calendar';
  await wait(30);
  const cell = document.querySelector(`.calendar-day[data-date="${futureDate}"]`);
  assert.ok(cell, 'the planned date should be visible in the current month view');
  const hollowDot = cell.querySelector('.calendar-dot.calendar-dot-hollow');
  assert.ok(hollowDot, 'a hollow dot should mark the planned occurrence');
  assert.match(hollowDot.getAttribute('style'), /#C4483C/i, "the dot should use the session's red color");

  click(cell);
  await wait(30);
  click(document.querySelector('[data-start-entry]'));
  await wait(30);
  assert.match(document.location.hash, /^#\/workout\//);

  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  document.location.hash = `/calendar/${futureDate.slice(0, 4)}/${parseInt(futureDate.slice(5, 7), 10)}`;
  await wait(30);
  const cellAfter = document.querySelector(`.calendar-day[data-date="${futureDate}"]`);
  assert.ok(cellAfter.querySelector('.calendar-dot:not(.calendar-dot-hollow)'), 'completed occurrence should now show a filled dot');
  assert.equal(cellAfter.querySelectorAll('.calendar-dot').length, 1, 'the plan should not ALSO still show as a separate hollow dot');
});

test('Calendar QA: backfilling a past date creates a completed workout editable from the day sheet, multiple per day supported', async () => {
  const { document, App } = await bootRealApp();
  const pastDate = App.utils.daysAgoISO(5);

  document.location.hash = '/calendar';
  await wait(30);
  const cell = document.querySelector(`.calendar-day[data-date="${pastDate}"]`);
  assert.ok(cell, 'the past date should be visible in the current month');
  click(cell);
  await wait(30);

  assert.ok(document.getElementById('add-workout-btn'), '+ Add Workout should be offered for a past date');
  click(document.getElementById('add-workout-btn'));
  await wait(20);
  click(document.querySelector('[data-blank]'));
  await wait(30);

  assert.match(document.location.hash, /^#\/workout\//);
  assert.ok(document.getElementById('save-btn'), 'a backfilled workout opens directly in edit mode, not active-logging mode');

  const firstId = document.location.hash.replace('#/workout/', '');
  const w = await App.queries.getWorkout(firstId);
  assert.equal(w.date, pastDate);
  assert.equal(w.status, 'completed');

  document.location.hash = '/calendar';
  await wait(30);
  click(document.querySelector(`.calendar-day[data-date="${pastDate}"]`));
  await wait(30);
  click(document.getElementById('add-workout-btn'));
  await wait(20);
  click(document.querySelector('[data-blank]'));
  await wait(30);
  const secondId = document.location.hash.replace('#/workout/', '');
  assert.notEqual(secondId, firstId);

  const completedThatDay = await App.queries.getCompletedWorkoutsInRange(pastDate, pastDate);
  assert.equal(completedThatDay.length, 2, 'two backfilled workouts on the same date must both exist');
});

test('Calendar QA: deleting a planned entry removes it from the day sheet but keeps the Session available in Train', async () => {
  const { document, App } = await bootRealApp();
  const session = await App.commands.createSession('Lower Body', [], 'blue');
  const futureDate = App.utils.daysAgoISO(-3);
  await App.commands.planCalendarEntry(futureDate, session.id);

  document.location.hash = '/calendar';
  await wait(30);
  click(document.querySelector(`.calendar-day[data-date="${futureDate}"]`));
  await wait(30);
  assert.ok(document.querySelector('[data-delete-entry]'));
  click(document.querySelector('[data-delete-entry]'));
  await wait(30);

  click(document.querySelector(`.calendar-day[data-date="${futureDate}"]`));
  await wait(30);
  assert.ok(!document.querySelector('[data-delete-entry]'), 'the plan should be gone from this date');

  document.location.hash = '/train';
  await wait(30);
  assert.match(document.body.textContent, /Lower Body/, 'the Session itself must still exist');
});
