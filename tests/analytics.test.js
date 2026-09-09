const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('bestRecordedSet picks heaviest weight, ties broken by more reps', () => {
  const App = freshApp();
  const sets = [
    { weight: 100, reps: 10 },
    { weight: 115, reps: 8 },
    { weight: 115, reps: 10 },
    { weight: 110, reps: 12 }
  ];
  const best = App.analytics.bestRecordedSet(sets);
  assert.equal(best.weight, 115);
  assert.equal(best.reps, 10);
});

test('bestEstimated1RM is derived from Epley and is independent of bestRecordedSet', () => {
  const App = freshApp();
  const sets = [{ weight: 100, reps: 10 }, { weight: 115, reps: 3 }];
  const est = App.analytics.bestEstimated1RM(sets);
  // Epley: 100*(1+10/30)=133.3, 115*(1+3/30)=126.5 -> heaviest ESTIMATE wins,
  // which need not be the heaviest actual recorded set.
  assert.equal(est, 133.3);
});

test('periodComparison compares trailing window vs. the preceding window of equal length', () => {
  const App = freshApp();
  const recentDate = App.utils.daysAgoISO(5);
  const olderDate = App.utils.daysAgoISO(40); // in the 31-60 day prior window for a 30-day comparison

  const history = [
    { workout: { date: recentDate }, sets: [{ weight: 125, reps: 5 }] },
    { workout: { date: olderDate }, sets: [{ weight: 100, reps: 5 }] }
  ];

  const cmp = App.analytics.periodComparison(history, 30, App.analytics.bestEstimated1RM);
  assert.equal(cmp.hasComparison, true);
  assert.ok(cmp.pctChange > 0, 'should show improvement when the recent window is stronger');
});

test('periodComparison reports no comparison when there is no prior-period data', () => {
  const App = freshApp();
  const history = [{ workout: { date: App.utils.daysAgoISO(2) }, sets: [{ weight: 115, reps: 8 }] }];
  const cmp = App.analytics.periodComparison(history, 30, App.analytics.bestEstimated1RM);
  assert.equal(cmp.hasComparison, false);
  assert.equal(cmp.pctChange, null);
});

test('PR detection: heaviest-weight PR and estimated-1RM PR are independent checks', () => {
  const App = freshApp();
  const priorSets = [{ weight: 100, reps: 10 }];
  assert.equal(App.analytics.isHeaviestWeightPR({ weight: 105, reps: 1 }, priorSets), true);
  assert.equal(App.analytics.isHeaviestWeightPR({ weight: 95, reps: 20 }, priorSets), false);
  assert.equal(App.analytics.isEstimated1RMPR({ weight: 95, reps: 20 }, priorSets), true, '95x20 has a higher estimated 1RM than 100x10 despite lighter weight');
});
