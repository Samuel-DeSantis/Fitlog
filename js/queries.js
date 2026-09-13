window.App = window.App || {};

App.queries = (function () {
  const db = App.db;

  async function getWorkout(id) {
    return db.get('workouts', id);
  }

  // Returns the single active workout, or null if there is none. Throws
  // MultipleActiveWorkoutsError if the invariant is somehow violated —
  // never silently picks one, since that would be an undetected repair.
  async function getActiveWorkout() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('active'));
    if (rows.length > 1) throw new App.errors.MultipleActiveWorkoutsError(rows);
    return rows[0] || null;
  }

  async function getLatestCompletedWorkout() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('completed'));
    rows.sort((a, b) => b.date.localeCompare(a.date) || (b.endedAt || '').localeCompare(a.endedAt || ''));
    return rows[0] || null;
  }

  async function getCompletedWorkoutsInRange(startDate, endDate) {
    const rows = await db.getAllByIndexRange('workouts', 'date', IDBKeyRange.bound(startDate, endDate));
    return rows.filter(w => w.status === 'completed').sort((a, b) => b.date.localeCompare(a.date));
  }

  async function getAllCompletedWorkouts() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('completed'));
    return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || '').localeCompare(a.startedAt || ''));
  }

  async function getSetsForWorkout(workoutId) {
    const rows = await db.getAllByIndexRange('sets', 'workoutId', IDBKeyRange.only(workoutId));
    return rows.sort((a, b) => a.setOrder - b.setOrder);
  }

  async function getSetsForWorkoutExercise(workoutId, exerciseId) {
    const rows = await getSetsForWorkout(workoutId);
    return rows.filter(s => s.exerciseId === exerciseId);
  }

  // Completed workouts touching this exercise, newest first. Only resolves
  // the workouts this exercise actually appears in, never a full scan.
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
      sets: byWorkout[wid].sort((a, b) => a.setOrder - b.setOrder)
    })).sort((a, b) => b.workout.date.localeCompare(a.workout.date));

    if (opts.limit) entries = entries.slice(0, opts.limit);
    return entries;
  }

  async function getPreviousPerformance(exerciseId, excludeWorkoutId) {
    const history = await getExerciseHistory(exerciseId, { limit: 5 });
    const match = history.find(h => h.workout.id !== excludeWorkoutId);
    return match ? match.sets : null;
  }

  async function getExercises(includeArchived) {
    const all = await db.getAll('exercises');
    return includeArchived ? all : all.filter(e => !e.archived);
  }

  // Every read normalizes color defensively (pre-color-feature sessions,
  // or imported data that lacks it) — callers never see an invalid color.
  async function getSessions() {
    const rows = await db.getAll('sessions');
    return rows.map(s => ({ ...s, color: App.sessionColors.normalize(s.color) }));
  }

  async function getSession(id) {
    const s = await db.get('sessions', id);
    return s ? { ...s, color: App.sessionColors.normalize(s.color) } : s;
  }

  async function getCalendarEntry(id) {
    return db.get('calendarEntries', id);
  }

  async function getCalendarEntriesInRange(startDate, endDate) {
    const rows = await db.getAllByIndexRange('calendarEntries', 'date', IDBKeyRange.bound(startDate, endDate));
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Pairs each calendar entry in range with its linked workout (if any),
  // resolving that lookup once here instead of in every view that needs
  // "is this entry planned, active, or completed". A dangling workoutId
  // (its workout was deleted) resolves to null, not an error — the entry
  // then reads as "planned" again, which is the correct fallback.
  async function getCalendarEntriesWithWorkouts(startDate, endDate) {
    const entries = await getCalendarEntriesInRange(startDate, endDate);
    const workouts = await Promise.all(entries.map(e => e.workoutId ? db.get('workouts', e.workoutId) : null));
    return entries.map((entry, i) => ({ entry, workout: workouts[i] || null }));
  }

  // 'planned' (no workout yet, or its workout was deleted), 'active', or
  // 'completed' — always derived from the linked workout's real status,
  // never stored redundantly on the entry itself, so it can't drift out
  // of sync with the workout it represents.
  function calendarEntryStatus(entryWithWorkout) {
    return entryWithWorkout.workout ? entryWithWorkout.workout.status : 'planned';
  }

  async function getSettings() {
    return (await db.get('settings', 'app')) || { id: 'app', unit: 'lb', bodyweight: null };
  }

  return {
    getWorkout, getActiveWorkout, getLatestCompletedWorkout,
    getCompletedWorkoutsInRange, getAllCompletedWorkouts,
    getSetsForWorkout, getSetsForWorkoutExercise,
    getExerciseHistory, getPreviousPerformance,
    getExercises, getSessions, getSession, getSettings,
    getCalendarEntry, getCalendarEntriesInRange, getCalendarEntriesWithWorkouts, calendarEntryStatus
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.queries;
