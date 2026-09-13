const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('1 & 3. daysInMonth is correct at month boundaries, including leap years', () => {
  const App = freshApp();
  assert.equal(App.utils.daysInMonth(2026, 0), 31, 'January');
  assert.equal(App.utils.daysInMonth(2026, 1), 28, 'February, non-leap year');
  assert.equal(App.utils.daysInMonth(2024, 1), 29, 'February, leap year');
  assert.equal(App.utils.daysInMonth(2026, 3), 30, 'April');
  assert.equal(App.utils.daysInMonth(2026, 11), 31, 'December');
});

test('2. addMonthsLocal navigates forward and backward, including across year boundaries', () => {
  const App = freshApp();
  assert.deepEqual(App.utils.addMonthsLocal(2026, 11, 1), { year: 2027, month: 0 }, 'Dec 2026 -> Jan 2027');
  assert.deepEqual(App.utils.addMonthsLocal(2027, 0, -1), { year: 2026, month: 11 }, 'Jan 2027 -> Dec 2026');
  assert.deepEqual(App.utils.addMonthsLocal(2026, 5, 1), { year: 2026, month: 6 });
  assert.deepEqual(App.utils.addMonthsLocal(2026, 0, -1), { year: 2025, month: 11 });
});

test('4. dateAtLocal never shifts due to UTC conversion, at any point in the month', () => {
  const App = freshApp();
  // The classic failure mode: toISOString().slice(0,10) on a Date
  // constructed with local year/month/day can report the PREVIOUS day for
  // timezones behind UTC. dateAtLocal must not do that.
  assert.equal(App.utils.dateAtLocal(2026, 0, 1), '2026-01-01');
  assert.equal(App.utils.dateAtLocal(2026, 0, 31), '2026-01-31');
  assert.equal(App.utils.dateAtLocal(2026, 11, 31), '2026-12-31');
});

test('firstWeekdayOfMonth matches native Date.getDay() semantics (0=Sunday)', () => {
  const App = freshApp();
  const expected = new Date(2026, 8, 1).getDay();
  assert.equal(App.utils.firstWeekdayOfMonth(2026, 8), expected);
});

test('formatMonthHeading produces a readable month/year label', () => {
  const App = freshApp();
  const heading = App.utils.formatMonthHeading(2026, 8);
  assert.match(heading, /2026/);
  assert.match(heading, /September/i);
});
