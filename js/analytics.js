window.App = window.App || {};

App.analytics = (function () {
  const utils = App.utils;

  function estimate1RM(weight, reps) {
    return utils.estimate1RM(weight, reps);
  }

  // Primary, factual number: the single heaviest completed set ever,
  // ties broken by more reps. Never superseded by the estimate below.
  function bestRecordedSet(sets) {
    return sets.reduce((best, s) => {
      if (s.weight == null || s.reps == null) return best;
      if (!best) return s;
      if (s.weight > best.weight) return s;
      if (s.weight === best.weight && s.reps > best.reps) return s;
      return best;
    }, null);
  }

  // Secondary, derived number: highest estimated 1RM across all sets.
  function bestEstimated1RM(sets) {
    let best = 0;
    sets.forEach((s) => {
      if (s.weight == null || s.reps == null) return;
      const v = estimate1RM(s.weight, s.reps);
      if (v > best) best = v;
    });
    return best;
  }

  function isHeaviestWeightPR(newSet, priorSets) {
    const priorBest = bestRecordedSet(priorSets);
    return !priorBest || newSet.weight > priorBest.weight;
  }

  function isEstimated1RMPR(newSet, priorSets) {
    const priorBest = bestEstimated1RM(priorSets);
    return estimate1RM(newSet.weight, newSet.reps) > priorBest;
  }

  function volumeForSets(sets) {
    return sets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
  }

  // Compares the best value in the trailing `days`-day window against the
  // best value in the preceding window of EQUAL length — e.g. last 30 days
  // vs. the 30 days before that. Never compares against an arbitrary single
  // past record. historyEntries: [{ workout: {date}, sets: [...] }, ...]
  function periodComparison(historyEntries, days, valueFn) {
    const today = utils.todayLocalISO();
    const currentStart = utils.daysAgoISO(days);
    const priorStart = utils.daysAgoISO(days * 2);

    const currentSets = [];
    const priorSets = [];
    historyEntries.forEach(({ workout, sets }) => {
      if (workout.date >= currentStart && workout.date <= today) currentSets.push(...sets);
      else if (workout.date >= priorStart && workout.date < currentStart) priorSets.push(...sets);
    });

    const currentBest = valueFn(currentSets);
    const priorBest = valueFn(priorSets);

    if (!priorSets.length || !priorBest) {
      return { currentBest, priorBest: null, pctChange: null, hasComparison: false };
    }
    const pctChange = Math.round(((currentBest - priorBest) / priorBest) * 100);
    return { currentBest, priorBest, pctChange, hasComparison: true };
  }

  return {
    estimate1RM, bestRecordedSet, bestEstimated1RM,
    isHeaviestWeightPR, isEstimated1RMPR, volumeForSets, periodComparison
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.analytics;
