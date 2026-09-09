window.App = window.App || {};

App.queries = (function () {
  const db = App.db;

  async function getWorkout(id) {
    return db.get('workouts', id);
  }

  async function getActiveWorkout() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('in_progress'));
    if (!rows.length) return null;
    // Deterministic, not "whatever the index happened to return first" —
    // matters if duplicates ever exist (see consolidateActiveWorkouts).
    rows.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    return rows[0];
  }

  async function getLatestCompletedWorkout() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('completed'));
    rows.sort((a, b) => b.date.localeCompare(a.date) || (b.endedAt || '').localeCompare(a.endedAt || ''));
    return rows[0] || null;
  }

  async function getWorkoutsInRange(startDate, endDate) {
    const rows = await db.getAllByIndexRange('workouts', 'date', IDBKeyRange.bound(startDate, endDate));
    return rows.filter(w => w.status === 'completed');
  }

  async function getWorkoutExercises(workoutId) {
    const rows = await db.getAllByIndexRange('workoutExercises', 'workoutId', IDBKeyRange.only(workoutId));
    return rows.sort((a, b) => a.order - b.order);
  }

  async function getSetsForWorkout(workoutId) {
    const rows = await db.getAllByIndexRange('sets', 'workoutId', IDBKeyRange.only(workoutId));
    return rows.sort((a, b) => a.setIndex - b.setIndex);
  }

  async function getSetsForWorkoutExercise(workoutExerciseId) {
    const rows = await db.getAllByIndexRange('sets', 'workoutExerciseId', IDBKeyRange.only(workoutExerciseId));
    return rows.sort((a, b) => a.setIndex - b.setIndex);
  }

  // Completed workouts touching this exercise, newest first. Only resolves
  // the (typically small) set of workouts this exercise actually appears
  // in — never a full workouts scan.
  async function getExerciseHistory(exerciseId, opts) {
    opts = opts || {};
    const allSets = await db.getAllByIndexRange('sets', 'exerciseId', IDBKeyRange.only(exerciseId));
    const workoutIds = [...new Set(allSets.map(s => s.workoutId))];
    const workouts = await Promise.all(workoutIds.map(id => db.get('workouts', id)));
    const wMap = Object.fromEntries(workouts.filter(Boolean).map(w => [w.id, w]));

    const byWorkout = {};
    allSets.forEach((s) => {
      const w = wMap[s.workoutId];
      if (!w || w.status !== 'completed') return;
      (byWorkout[s.workoutId] = byWorkout[s.workoutId] || []).push(s);
    });

    let entries = Object.keys(byWorkout).map(wid => ({
      workout: wMap[wid],
      sets: byWorkout[wid].sort((a, b) => a.setIndex - b.setIndex)
    })).sort((a, b) => b.workout.date.localeCompare(a.workout.date));

    if (opts.limit) entries = entries.slice(0, opts.limit);
    return entries;
  }

  // Most recent completed performance of this exercise, excluding the
  // workout currently being logged.
  async function getPreviousPerformance(exerciseId, excludeWorkoutId) {
    const history = await getExerciseHistory(exerciseId, { limit: 5 });
    const match = history.find(h => h.workout.id !== excludeWorkoutId);
    return match ? match.sets : null;
  }

  async function getNutritionForDate(date) {
    return db.get('nutritionLogs', date);
  }

  async function getNutritionForRange(startDate, endDate) {
    return db.getByKeyRange('nutritionLogs', IDBKeyRange.bound(startDate, endDate));
  }

  async function getSleepForRange(startDate, endDate) {
    return db.getAllByIndexRange('sleepLogs', 'date', IDBKeyRange.bound(startDate, endDate));
  }

  async function getSleepForDate(date) {
    const rows = await db.getAllByIndexRange('sleepLogs', 'date', IDBKeyRange.only(date));
    return rows[0] || null;
  }

  async function getLatestSleep() {
    const rows = await db.getAllByIndexRange('sleepLogs', 'date');
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows[rows.length - 1] || null;
  }

  async function getBodyweightForRange(startDate, endDate) {
    return db.getAllByIndexRange('bodyweightLogs', 'date', IDBKeyRange.bound(startDate, endDate));
  }

  async function getLatestBodyweight() {
    const all = await db.getAllByIndexRange('bodyweightLogs', 'date');
    all.sort((a, b) => a.date.localeCompare(b.date));
    return all[all.length - 1] || null;
  }

  async function getBodyweightOnOrBefore(date) {
    const all = await db.getAllByIndexRange('bodyweightLogs', 'date', IDBKeyRange.upperBound(date));
    all.sort((a, b) => b.date.localeCompare(a.date));
    return all[0] || null;
  }

  async function getExercises(includeArchived) {
    const all = await db.getAll('exercises');
    return includeArchived ? all : all.filter(e => !e.archived);
  }

  async function getTemplates() {
    return db.getAll('templates');
  }

  return {
    getWorkout, getActiveWorkout, getLatestCompletedWorkout, getWorkoutsInRange,
    getWorkoutExercises, getSetsForWorkout, getSetsForWorkoutExercise,
    getExerciseHistory, getPreviousPerformance,
    getNutritionForDate, getNutritionForRange,
    getSleepForRange, getSleepForDate, getLatestSleep,
    getBodyweightForRange, getLatestBodyweight, getBodyweightOnOrBefore,
    getExercises, getTemplates
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.queries;
