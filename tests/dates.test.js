const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('todayLocalISO uses local calendar fields, not UTC', () => {
  const App = freshApp();
  const d = new Date(2026, 0, 1, 0, 30); // Jan 1, local 00:30 — near-midnight case
  const iso = App.utils.localISOFromDate(d);
  assert.equal(iso, '2026-01-01');
});

test('daysAgoISO(7) is exactly 7 calendar days before today, in local time', () => {
  const App = freshApp();
  const today = new Date();
  const expected = new Date(today);
  expected.setDate(today.getDate() - 7);
  const expectedISO = App.utils.localISOFromDate(expected);
  assert.equal(App.utils.daysAgoISO(7), expectedISO);
});

test('formatDateLabel recognizes Today and Yesterday', () => {
  const App = freshApp();
  const today = App.utils.todayLocalISO();
  const yesterday = App.utils.daysAgoISO(1);
  assert.equal(App.utils.formatDateLabel(today), 'Today');
  assert.equal(App.utils.formatDateLabel(yesterday), 'Yesterday');
});
