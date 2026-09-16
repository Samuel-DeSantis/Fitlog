const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, wait } = require('./helpers/domSetup');

test('Calendar scroll-snap: week rows are grouped, and the route-scoping class toggles correctly', async () => {
  const { document } = await bootRealApp();

  // Not on Calendar yet — the route class must be absent.
  assert.equal(document.documentElement.classList.contains('route-calendar'), false);

  document.location.hash = '/calendar';
  await wait(30);

  // Scopes the container-level scroll-snap CSS (see styles.css and the
  // calendar-scroll-snap-css.test.js source check) to the Calendar route.
  assert.ok(document.documentElement.classList.contains('route-calendar'), 'entering Calendar should scope scroll-snap to this route');

  const weekRows = document.querySelectorAll('.calendar-week-row');
  assert.ok(weekRows.length > 0, 'calendar days should be grouped into week rows');
  weekRows.forEach((row) => {
    assert.equal(row.querySelectorAll('.calendar-day').length, 7, 'every week row should be a complete 7-day group, even at a month boundary');
  });

  // Day cells should live inside week rows now, not directly in the grid —
  // scroll-snap settles on whole week rows, never an individual date cell.
  const grid = document.querySelector('.calendar-grid');
  const directDayChildren = [...grid.children].filter(c => c.classList.contains('calendar-day'));
  assert.equal(directDayChildren.length, 0, 'day cells should be grouped under week rows, not direct children of the grid');
  assert.ok([...grid.children].every(c => c.classList.contains('calendar-week-row')), 'the grid should contain only week rows');

  // #calendar-scroll (the real scrolling container once styles.css is
  // applied — see calendar-scroll-snap-css.test.js) must exist and
  // actually contain the week rows.
  const scrollEl = document.getElementById('calendar-scroll');
  assert.ok(scrollEl, '#calendar-scroll should exist as the dedicated scroll container');
  assert.ok(scrollEl.contains(grid), 'the week-row grid should live inside the scroll container');

  // Tapping a date and the existing detail-sheet behavior are unaffected
  // by the new row grouping.
  const anyDay = document.querySelector('.calendar-day[data-date]');
  click(anyDay);
  await wait(30);
  assert.ok(document.querySelector('.modal-header h2'), 'day-detail sheet should still open normally');

  // Leaving Calendar should turn the route-scoped snap back off.
  document.location.hash = '/today';
  await wait(30);
  assert.equal(document.documentElement.classList.contains('route-calendar'), false, 'leaving Calendar should remove the route class');
});
