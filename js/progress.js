window.App = window.App || {};

// The Progress query layer: derives statistics from actual, completed
// Workout/Set data. This is a read-only consumer — nothing here ever
// writes to workouts, sets, sessions, calendar entries, or exercises.
//
// The one rule every function here obeys: a set counts as real
// performance only when it is genuinely confirmed —
// `set.completedAt != null` — never a prescribed blank set (Phase 4.3)
// and never a copied-but-unconfirmed value (Phase 3's Add Set). This
// mirrors commands.isSetCompleted directly rather than depending on
// commands.js from here, the same reasoning queries.js's
// getPreviousPerformance already documents, to keep the
// db -> queries -> progress layering one-directional. A Session's own
// prescription (targetSets/repMin/repMax) is never read by anything in
// this file at all — Progress has no notion of "prescribed", only of
// what was actually logged.
//
// Deliberately NOT here (see the Phase 5 brief): estimated 1RM (the
// existing App.analytics/App.utils.estimate1RM already do this, but are
// unused everywhere and intentionally not wired into Progress this
// phase), muscle-group/bodyweight analytics, streaks, RPE, progression
// recommendations, or any chart beyond the two plain series below.
App.progress = (function () {
  const queries = App.queries;
  const db = App.db;

  function isCompleted(set) {
    return set.completedAt != null;
  }

  // All-time completed-performance history for one exercise, newest
  // workout first. Built on top of queries.getExerciseHistory (which
  // already resolves only completed Workouts via the exerciseId index,
  // no full-table scan) and then strips out any set that isn't itself
  // confirmed-complete. A workout that ends up with zero completed sets
  // for this exercise (e.g. finished with everything left blank) is
  // dropped entirely — it has no performance to show.
  async function getCompletedHistory(exerciseId) {
    const entries = await queries.getExerciseHistory(exerciseId);
    return entries
      .map(({ workout, sets }) => ({ workout, sets: sets.filter(isCompleted) }))
      .filter(entry => entry.sets.length > 0);
  }

  // Highest completed weight ever recorded, or null if there's no
  // completed history at all.
  function bestWeight(history) {
    let best = null;
    history.forEach(({ sets }) => sets.forEach((s) => {
      if (s.weight != null && (best === null || s.weight > best)) best = s.weight;
    }));
    return best;
  }

  // Highest completed rep count for any single set, or null if none.
  function bestReps(history) {
    let best = null;
    history.forEach(({ sets }) => sets.forEach((s) => {
      if (s.reps != null && (best === null || s.reps > best)) best = s.reps;
    }));
    return best;
  }

  // Narrower variant: highest completed rep count among sets performed
  // at exactly the given weight.
  function bestRepsAtWeight(history, weight) {
    let best = null;
    history.forEach(({ sets }) => sets.forEach((s) => {
      if (s.weight === weight && s.reps != null && (best === null || s.reps > best)) best = s.reps;
    }));
    return best;
  }

  // Sum of weight x reps across every completed set. Never counts a
  // Session's prescribed targetSets/repMin/repMax — those describe
  // intent, not anything actually moved.
  function totalVolume(history) {
    let sum = 0;
    history.forEach(({ sets }) => sets.forEach((s) => {
      if (s.weight != null && s.reps != null) sum += s.weight * s.reps;
    }));
    return sum;
  }

  // Most recent completed performance entry ({workout, sets}), or null.
  // getCompletedHistory is already newest-first, so this is just its head.
  function mostRecent(history) {
    return history[0] || null;
  }

  // One compact line per workout for the History list, e.g. "155×5, 5, 4"
  // — a weight repeated across consecutive sets is shown only once,
  // mirroring the same compaction already used for previous-performance
  // on the active workout screen (see workout.js's formatPreviousPerformance).
  function formatHistoryLine(sets) {
    let lastWeight = null;
    return sets.map((s) => {
      const sameAsLast = lastWeight !== null && s.weight === lastWeight;
      lastWeight = s.weight;
      return sameAsLast ? `${s.reps}` : `${s.weight}×${s.reps}`;
    }).join(', ');
  }

  // One point per completed workout, oldest first (charts read left to
  // right) — exactly what the two V1 charts (best weight over time,
  // volume over time) need and nothing more.
  function chartSeries(history) {
    return [...history].reverse().map(({ workout, sets }) => {
      let maxWeight = null;
      let volume = 0;
      sets.forEach((s) => {
        if (s.weight != null && (maxWeight === null || s.weight > maxWeight)) maxWeight = s.weight;
        if (s.weight != null && s.reps != null) volume += s.weight * s.reps;
      });
      return { date: workout.date, bestWeight: maxWeight, volume };
    });
  }

  // Everything the Progress page needs for one exercise, in one call.
  async function getExerciseSummary(exerciseId) {
    const history = await getCompletedHistory(exerciseId);
    return {
      exerciseId,
      hasHistory: history.length > 0,
      bestWeight: bestWeight(history),
      bestReps: bestReps(history),
      totalVolume: totalVolume(history),
      mostRecent: mostRecent(history),
      history,
      chartSeries: chartSeries(history)
    };
  }

  // Which exercises belong in the Progress exercise picker: only ones
  // with at least one completed set, ever — archived exercises included,
  // since real history shouldn't disappear just because the exercise was
  // later archived. A plain scan of 'sets' is used rather than adding a
  // new IndexedDB index: this is a local single-user dataset (hundreds,
  // not millions, of sets), so a full pass here is appropriately simple
  // for a local-first app rather than premature optimization.
  async function getExercisesWithHistory() {
    const [allExercises, allSets, completedWorkouts] = await Promise.all([
      queries.getExercises(true),
      db.getAll('sets'),
      queries.getAllCompletedWorkouts()
    ]);
    const completedWorkoutIds = new Set(completedWorkouts.map(w => w.id));
    const exerciseIdsWithHistory = new Set(
      allSets
        .filter(s => isCompleted(s) && completedWorkoutIds.has(s.workoutId))
        .map(s => s.exerciseId)
    );
    return allExercises.filter(e => exerciseIdsWithHistory.has(e.id));
  }

  return {
    getCompletedHistory, bestWeight, bestReps, bestRepsAtWeight, totalVolume,
    mostRecent, formatHistoryLine, chartSeries, getExerciseSummary, getExercisesWithHistory
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.progress;
