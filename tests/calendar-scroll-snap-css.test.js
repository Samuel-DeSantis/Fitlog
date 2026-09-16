const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// jsdom (used by the .dom.test.js files) never loads css/styles.css, so it
// can't verify actual computed styles like overflow/scroll-snap-type or
// real layout/scrolling. This is a pragmatic, low-cost source-level check
// that the CSS wiring is actually pointed at the real Calendar scroll
// container rather than the document/root — actual on-device scrolling
// behavior still needs a real-browser/mobile check (see the Phase 3
// follow-up report).
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds the declaration block { ... } for a single, literal (not
// comma-grouped) CSS selector.
function ruleBodyFor(selector) {
  const re = new RegExp(escapeRegex(selector) + '\\s*{([^}]*)}');
  const match = css.match(re);
  return match ? match[1] : null;
}

test('Calendar scroll-snap: scroll-snap-type is applied to the real #calendar-scroll container, not html/body', () => {
  const scrollRule = ruleBodyFor('html.route-calendar #calendar-scroll');
  assert.ok(scrollRule, 'expected a rule scoping #calendar-scroll to the Calendar route');
  assert.match(scrollRule, /scroll-snap-type\s*:\s*y\s+proximity/, 'scroll-snap-type should be gentle (proximity) and live on the actual scroll container');
  assert.match(scrollRule, /overflow-y\s*:\s*auto/, '#calendar-scroll must actually be a scrolling container (overflow-y: auto) for scroll-snap to mean anything on it');

  // scroll-snap-type must not be declared directly on html or body
  // anywhere in the file — that was the earlier, less reliable approach
  // this follow-up replaces with a real, dedicated scroll container.
  assert.doesNotMatch(css, /(?:^|\s)(?:html|body)\s*(?:\.[\w-]+)?\s*{[^}]*scroll-snap-type/, 'scroll-snap-type should not be set on the document/root element');
});

test('Calendar scroll-snap: week rows are the snap targets, at row granularity', () => {
  const rowRule = ruleBodyFor('.calendar-week-row');
  assert.ok(rowRule, 'expected a .calendar-week-row rule');
  assert.match(rowRule, /scroll-snap-align\s*:\s*start/, 'week rows should be the snap-align targets, not individual day cells');

  // No day-cell-level snap-align — snapping must stay at the row, not the
  // individual date, level.
  const dayCellRule = ruleBodyFor('.calendar-day');
  assert.ok(dayCellRule, 'expected a .calendar-day rule');
  assert.doesNotMatch(dayCellRule, /scroll-snap-align/, 'individual day cells must not be scroll-snap targets');
});

test('Calendar scroll-snap: the page itself is locked from scrolling behind the dedicated scroll container', () => {
  assert.match(css, /html\.route-calendar[\s\S]{0,120}overflow\s*:\s*hidden/, 'the document should not scroll independently while Calendar owns its own internal scroll container');
});
