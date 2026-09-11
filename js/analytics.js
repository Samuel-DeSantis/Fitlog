window.App = window.App || {};

App.analytics = (function () {
  const utils = App.utils;

  function estimate1RM(weight, reps) {
    return utils.estimate1RM(weight, reps);
  }

  // Primary, factual: the heaviest completed set ever, ties broken by reps.
  function bestRecordedSet(sets) {
    return sets.reduce((best, s) => {
      if (s.weight == null || s.reps == null) return best;
      if (!best) return s;
      if (s.weight > best.weight) return s;
      if (s.weight === best.weight && s.reps > best.reps) return s;
      return best;
    }, null);
  }

  // Secondary, derived: highest estimated 1RM across all completed sets.
  function bestEstimated1RM(sets) {
    let best = 0;
    sets.forEach((s) => {
      if (s.weight == null || s.reps == null) return;
      const v = estimate1RM(s.weight, s.reps);
      if (v > best) best = v;
    });
    return best;
  }

  function volumeForSets(sets) {
    return sets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
  }

  return { estimate1RM, bestRecordedSet, bestEstimated1RM, volumeForSets };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.analytics;
