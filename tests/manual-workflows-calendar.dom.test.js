const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Calendar QA: vertical scroll shows multiple months, no month-nav controls, and centers on today', async () => {
  const { document, window, App } = await bootRealApp();

  let scrolledElement = null;
  window.Element.prototype.scrollIntoView = function () {
    scrolledElement = this;
  };

  document.location.hash = '/calendar';
  await wait(60);

  const headings = document.querySelectorAll('.calendar-month-heading');
  assert.ok(headings.length >= 6, 'multiple months should be rendered in one continuous scroll');
  assert.equal(document.getElementById('prev-month'), null, 'prev/next navigation should be removed');
  assert.equal(document.getElementById('next-month'), null, 'prev/next navigation should be removed');
  assert.equal(document.querySelector('.calendar-nav'), null, 'the nav row itself should be gone');

  const todayStr = App.utils.todayLocalISO();
  const todayCell = document.querySelector(`.calendar-day[data-date="${todayStr}"]`);
  assert.ok(todayCell, "today's cell should be present");
  assert.ok(todayCell.classList.contains('is-today'), 'today should be visually distinguished');
  assert.equal(scrolledElement, todayCell, "the view should scroll today's cell into view on open");

  const recentHistory = App.utils.daysAgoISO(60);
  const upcoming = App.utils.daysAgoISO(-60);
  assert.ok(document.querySelector(`.calendar-day[data-date="${recentHistory}"]`), 'recent history should be visible above today');
  assert.ok(document.querySelector(`.calendar-day[data-date="${upcoming}"]`), 'upcoming dates should be visible below today');

  const farPast = App.utils.daysAgoISO(400);
  assert.equal(document.querySelector(`.calendar-day[data-date="${farPast}"]`), null, 'the rendered window should be bounded, not infinite');
});

test('Calendar QA: plan a future Session, see a hollow colored dot, start it, finish it, see it become filled', async () => {
  const { document, App } = await bootRealApp();

  // Create a red "Upper Body" session via Train first.
  document.location.hash = '/train';
  await wait(60);
  click(document.getElementById('create-session-btn'));
  await wait(40);
  setValue(document.querySelector('#session-name'), 'Upper Body');
  document.querySelector('[data-color="red"]').click();
  click(document.getElementById('session-add-exercise'));
  await wait(40);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(40);
  click(document.querySelector('.modal-list-item'));
  await wait(40);
  click(document.getElementById('session-save'));
  await wait(60);

  const futureDate = App.utils.daysAgoISO(-6);
  const session = (await App.queries.getSessions())[0];
  await App.commands.planCalendarEntry(futureDate, session.id);

  document.location.hash = '/calendar';
  await wait(60);
  const cell = document.querySelector(`.calendar-day[data-date="${futureDate}"]`);
  assert.ok(cell, 'the planned date should be visible in the current month view');
  const hollowDot = cell.querySelector('.calendar-dot.calendar-dot-hollow');
  assert.ok(hollowDot, 'a hollow dot should mark the planned occurrence');
  assert.match(hollowDot.getAttribute('style'), /#B85A52/i, "the dot should use the session's red color");

  click(cell);
  await wait(60);
  click(document.querySelector('[data-start-entry]'));
  await wait(60);
  assert.match(document.location.hash, /^#\/workout\//);

  click(document.getElementById('finish-workout-btn'));
  await wait(60);

  document.location.hash = '/calendar';
  await wait(60);
  const cellAfter = document.querySelector(`.calendar-day[data-date="${futureDate}"]`);
  assert.ok(cellAfter.querySelector('.calendar-dot:not(.calendar-dot-hollow)'), 'completed occurrence should now show a filled dot');
  assert.equal(cellAfter.querySelectorAll('.calendar-dot').length, 1, 'the plan should not ALSO still show as a separate hollow dot');
});

test('Calendar QA: backfilling a past date creates a completed workout editable from the day sheet, multiple per day supported', async () => {
  const { document, App } = await bootRealApp();
  const pastDate = App.utils.daysAgoISO(5);

  document.location.hash = '/calendar';
  await wait(60);
  const cell = document.querySelector(`.calendar-day[data-date="${pastDate}"]`);
  assert.ok(cell, 'the past date should be visible in the current month');
  click(cell);
  await wait(60);

  assert.ok(document.getElementById('add-workout-btn'), '+ Add Workout should be offered for a past date');
  click(document.getElementById('add-workout-btn'));
  await wait(40);
  click(document.querySelector('[data-blank]'));
  await wait(60);

  assert.match(document.location.hash, /^#\/workout\//);
  assert.ok(document.getElementById('save-btn'), 'a backfilled workout opens directly in edit mode, not active-logging mode');

  const firstId = document.location.hash.replace('#/workout/', '');
  const w = await App.queries.getWorkout(firstId);
  assert.equal(w.date, pastDate);
  assert.equal(w.status, 'completed');

  document.location.hash = '/calendar';
  await wait(60);
  click(document.querySelector(`.calendar-day[data-date="${pastDate}"]`));
  await wait(60);
  click(document.getElementById('add-workout-btn'));
  await wait(40);
  click(document.querySelector('[data-blank]'));
  await wait(60);
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
  await wait(60);
  click(document.querySelector(`.calendar-day[data-date="${futureDate}"]`));
  await wait(60);
  assert.ok(document.querySelector('[data-delete-entry]'));
  click(document.querySelector('[data-delete-entry]'));
  await wait(60);

  click(document.querySelector(`.calendar-day[data-date="${futureDate}"]`));
  await wait(60);
  assert.ok(!document.querySelector('[data-delete-entry]'), 'the plan should be gone from this date');

  document.location.hash = '/train';
  await wait(60);
  assert.match(document.body.textContent, /Lower Body/, 'the Session itself must still exist');
});

test('Calendar QA BUGFIX: starting a plan while another workout is active shows a clear message and does not attach it', async () => {
  const { document, App } = await bootRealApp();

  const sessionA = await App.commands.createSession('Upper Body', [], 'red');
  const sessionB = await App.commands.createSession('Lower Body', [], 'blue');
  const dateA = App.utils.daysAgoISO(-2);
  const dateB = App.utils.daysAgoISO(-4);
  await App.commands.planCalendarEntry(dateA, sessionA.id);
  const entryB = await App.commands.planCalendarEntry(dateB, sessionB.id);

  document.location.hash = '/calendar';
  await wait(60);
  click(document.querySelector(`.calendar-day[data-date="${dateA}"]`));
  await wait(60);
  click(document.querySelector('[data-start-entry]'));
  await wait(60);
  assert.match(document.location.hash, /^#\/workout\//, 'plan A should have started normally');

  let alertMessage = null;
  global.alert = (msg) => { alertMessage = msg; };

  document.location.hash = '/calendar';
  await wait(60);
  click(document.querySelector(`.calendar-day[data-date="${dateB}"]`));
  await wait(60);
  const startBtnB = document.querySelector('[data-start-entry]');
  click(startBtnB);
  await wait(60);

  assert.ok(alertMessage, 'a clear message should have been shown');
  assert.match(alertMessage, /Upper Body|already have/i);
  assert.equal(startBtnB.disabled, false, 'the button should be re-enabled so the user can back out');

  const reloadedB = await App.queries.getCalendarEntry(entryB.id);
  assert.equal(reloadedB.workoutId, null, "plan B must remain unattached to plan A's active workout");
});

test('Calendar QA: header shows the current year, day-detail heading uses compact weekday format', async () => {
  const { document, App } = await bootRealApp();
  document.location.hash = '/calendar';
  await wait(30);

  const heading = document.querySelector('.view-header h1').textContent;
  const currentYear = new Date().getFullYear();
  assert.equal(heading, `Calendar · ${currentYear}`);

  const todayStr = App.utils.todayLocalISO();
  click(document.querySelector(`.calendar-day[data-date="${todayStr}"]`));
  await wait(30);

  const dayHeading = document.querySelector('.modal-header h2').textContent;
  assert.equal(dayHeading, App.utils.formatDateCompact(todayStr));
  assert.match(dayHeading, /^[A-Za-z]{3} · [A-Za-z]{3} \d{1,2}$/);
});

test('Calendar QA: the header is sticky, but each month has its own (non-sticky) weekday row', async () => {
  const { document } = await bootRealApp();
  document.location.hash = '/calendar';
  await wait(30);

  const stickyHeader = document.querySelector('.calendar-sticky-header');
  assert.ok(stickyHeader, 'a sticky header wrapper should exist');
  assert.ok(stickyHeader.querySelector('.view-header h1'), 'the page heading should be inside the sticky wrapper');
  assert.equal(stickyHeader.querySelector('.calendar-weekdays'), null, 'the weekday row is no longer global/sticky — it now belongs to each month');

  // The scrolling month content must be a SIBLING of the sticky header,
  // not nested inside it, or it would scroll away together with it.
  const scrollArea = document.getElementById('calendar-scroll');
  assert.ok(scrollArea, 'the scrolling months container should exist');
  assert.equal(stickyHeader.contains(scrollArea), false, 'month content must live outside the sticky wrapper');

  // Every month block gets its own weekday row, directly under its own
  // month heading, and it scrolls with that month rather than staying
  // pinned to the top.
  const monthBlocks = document.querySelectorAll('.calendar-month-block');
  assert.ok(monthBlocks.length > 1, 'the fixture window should span more than one month');
  monthBlocks.forEach((block) => {
    const heading = block.querySelector('.calendar-month-heading');
    const weekdays = block.querySelector('.calendar-weekdays');
    assert.ok(weekdays, 'each month block should have its own weekday row');
    assert.equal(stickyHeader.contains(weekdays), false, 'a month\'s weekday row must not live in the sticky header');
    assert.equal(weekdays.querySelectorAll('span').length, 7, 'Sun through Sat');
    assert.equal(weekdays.textContent.trim().slice(0, 3), 'Sun', 'starts the week on Sunday');
    // Directly under that month's own heading — immediately after it,
    // before the day grid.
    assert.equal(heading.nextElementSibling, weekdays, "the weekday row sits directly under this month's own heading");
    assert.equal(weekdays.nextElementSibling.classList.contains('calendar-grid'), true, "the day grid follows this month's weekday row");
  });
});
