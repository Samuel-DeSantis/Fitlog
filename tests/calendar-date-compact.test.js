const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('formatDateCompact produces "Weekday · Mon Day" using the LOCAL calendar date', () => {
  const App = freshApp();
  const dateStr = '2026-09-14';
  const expectedWeekday = new Date(2026, 8, 14).toLocaleDateString(undefined, { weekday: 'short' });
  const expectedMonthDay = new Date(2026, 8, 14).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert.equal(App.utils.formatDateCompact(dateStr), `${expectedWeekday} · ${expectedMonthDay}`);
});

test('formatDateCompact matches the example format exactly (weekday, middot, month, day)', () => {
  const App = freshApp();
  const result = App.utils.formatDateCompact('2026-09-14');
  assert.match(result, /^[A-Za-z]{3} · [A-Za-z]{3} \d{1,2}$/, 'e.g. "Sun · Sep 14"');
});

test('formatDateCompact never shifts a day due to UTC parsing, at various month/year boundaries', () => {
  const App = freshApp();
  const cases = [
    { year: 2026, month0: 0, day: 1 },
    { year: 2026, month0: 0, day: 31 },
    { year: 2026, month0: 11, day: 31 },
    { year: 2024, month0: 1, day: 29 }
  ];
  for (const { year, month0, day } of cases) {
    const iso = App.utils.dateAtLocal(year, month0, day);
    const local = new Date(year, month0, day);
    const expected = local.toLocaleDateString(undefined, { weekday: 'short' }) + ' · ' +
      local.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    assert.equal(App.utils.formatDateCompact(iso), expected, `mismatch for ${iso}`);
  }
});

test('formatDateHeading (used elsewhere, e.g. Today) is untouched by this change', () => {
  const App = freshApp();
  const result = App.utils.formatDateHeading('2026-09-14');
  const expected = new Date(2026, 8, 14).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  assert.equal(result, expected);
});
