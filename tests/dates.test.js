const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('todayLocalISO uses local calendar fields, not UTC', () => {
  const App = freshApp();
  const d = new Date(2026, 0, 1, 0, 30); // Jan 1, local 00:30 — near-midnight case
  assert.equal(App.utils.localISOFromDate(d), '2026-01-01');
});

test('daysAgoISO(7) is exactly 7 calendar days before today, in local time', () => {
  const App = freshApp();
  const expected = new Date();
  expected.setDate(expected.getDate() - 7);
  assert.equal(App.utils.daysAgoISO(7), App.utils.localISOFromDate(expected));
});

test('formatDateLabel recognizes Today and Yesterday', () => {
  const App = freshApp();
  assert.equal(App.utils.formatDateLabel(App.utils.todayLocalISO()), 'Today');
  assert.equal(App.utils.formatDateLabel(App.utils.daysAgoISO(1)), 'Yesterday');
});
