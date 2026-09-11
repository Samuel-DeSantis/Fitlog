window.App = window.App || {};

App.commands = (function () {
  const db = App.db;
  const utils = App.utils;

  async function createWorkout(opts) {
    opts = opts || {};
    const workout = {
      id: utils.uuid(),
      sessionId: opts.sessionId || null,
      title: opts.title || 'Workout',
      date: opts.date || utils.todayLocalISO(),
      status: 'active',
      exerciseOrder: opts.exerciseIds ? [...opts.exerciseIds] : [],
      notes: '',
      startedAt: utils.nowISO(),
      endedAt: null,
      createdAt: utils.nowISO(),
      updatedAt: utils.nowISO()
    };
    await db.put('workouts', workout);
    return workout;
  }

  // The ONLY path the UI should use to start a workout. If an active
  // workout already exists — including the double-tap/race case where two
  // start actions fire before the first write lands — this resumes it
  // instead of creating a duplicate.
  async function startWorkout(title, exerciseIds, sessionId) {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    return createWorkout({ title, exerciseIds, sessionId: sessionId || null });
  }

  // Same exercise structure as the last completed workout. Copies NO
  // numbers — previous performance stays visible as reference only.
  async function repeatLastWorkout() {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    const last = await App.queries.getLatestCompletedWorkout();
    if (!last) return null;
    return createWorkout({ title: last.title, exerciseIds: last.exerciseOrder, sessionId: last.sessionId });
  }

  async function startFromSession(session) {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    return createWorkout({ title: session.name, exerciseIds: session.exercises, sessionId: session.id });
  }

  // Safety net for the rare true race where two startWorkout() reads both
  // see "no active workout" before either write commits. Keeps the most
  // recently started workout active, marks the rest completed — never
  // deletes a set.
  async function consolidateActiveWorkouts() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('active'));
    if (rows.length <= 1) return { resolvedCount: 0 };
    rows.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const extras = rows.slice(1);
    for (const w of extras) {
      w.status = 'completed';
      w.endedAt = w.updatedAt || w.startedAt;
      w.updatedAt = utils.nowISO();
      await db.put('workouts', w);
    }
    return { resolvedCount: extras.length };
  }

  async function addExerciseToWorkout(workoutId, exerciseId) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    if (!workout.exerciseOrder.includes(exerciseId)) {
      workout.exerciseOrder = [...workout.exerciseOrder, exerciseId];
      workout.updatedAt = utils.nowISO();
      await db.put('workouts', workout);
    }
    return workout;
  }

  async function removeExerciseFromWorkout(workoutId, exerciseId) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    workout.exerciseOrder = workout.exerciseOrder.filter(id => id !== exerciseId);
    workout.updatedAt = utils.nowISO();
    await db.put('workouts', workout);

    const sets = await App.queries.getSetsForWorkoutExercise(workoutId, exerciseId);
    for (const s of sets) await db.remove('sets', s.id);
    return workout;
  }

  async function reorderExercises(workoutId, orderedExerciseIds) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    workout.exerciseOrder = [...orderedExerciseIds];
    workout.updatedAt = utils.nowISO();
    await db.put('workouts', workout);
    return workout;
  }

  // Adds a blank set. Never pre-fills weight/reps from history — that
  // would silently treat "what I did last time" as "what I did just now".
  async function addSet(workoutId, exerciseId) {
    const existing = await App.queries.getSetsForWorkoutExercise(workoutId, exerciseId);
    const set = {
      id: utils.uuid(),
      workoutId,
      exerciseId,
      setOrder: existing.length,
      weight: null,
      reps: null,
      completedAt: null
    };
    await db.put('sets', set);
    return set;
  }

  async function copyToNewSet(workoutId, exerciseId, previousSet) {
    const set = await addSet(workoutId, exerciseId);
    return updateSet(set.id, { weight: previousSet.weight, reps: previousSet.reps });
  }

  // completedAt is derived, not assumed: it is set the instant a set has
  // both weight and reps, and cleared if either is removed. Nothing else
  // in the app is allowed to set it directly.
  async function updateSet(setId, fields) {
    const set = await db.get('sets', setId);
    if (!set) return null;
    if ('weight' in fields) set.weight = fields.weight;
    if ('reps' in fields) set.reps = fields.reps;
    set.completedAt = (set.weight != null && set.reps != null) ? (set.completedAt || utils.nowISO()) : null;
    await db.put('sets', set);
    return set;
  }

  function isSetCompleted(set) {
    return set.weight != null && set.reps != null;
  }

  async function deleteSet(setId) {
    await db.remove('sets', setId);
  }

  async function finishWorkout(workoutId) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    workout.status = 'completed';
    workout.endedAt = utils.nowISO();
    workout.updatedAt = utils.nowISO();
    await db.put('workouts', workout);
    return workout;
  }

  async function editWorkoutMeta(workoutId, fields) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    Object.assign(workout, fields, { updatedAt: utils.nowISO() });
    await db.put('workouts', workout);
    return workout;
  }

  async function deleteWorkout(workoutId) {
    const sets = await App.queries.getSetsForWorkout(workoutId);
    for (const s of sets) await db.remove('sets', s.id);
    await db.remove('workouts', workoutId);
  }

  async function createExercise(name) {
    const ex = { id: utils.uuid(), name, archived: false, createdAt: utils.nowISO(), updatedAt: utils.nowISO() };
    await db.put('exercises', ex);
    return ex;
  }

  // Archiving preserves the record and every historical reference to it —
  // it only hides the exercise from future pickers.
  async function archiveExercise(exerciseId) {
    const ex = await db.get('exercises', exerciseId);
    if (!ex) return null;
    ex.archived = true;
    ex.updatedAt = utils.nowISO();
    await db.put('exercises', ex);
    return ex;
  }

  async function createSession(name, exerciseIds) {
    const session = { id: utils.uuid(), name, exercises: [...exerciseIds], createdAt: utils.nowISO(), updatedAt: utils.nowISO() };
    await db.put('sessions', session);
    return session;
  }

  async function updateSession(id, fields) {
    const session = await db.get('sessions', id);
    if (!session) return null;
    Object.assign(session, fields, { updatedAt: utils.nowISO() });
    await db.put('sessions', session);
    return session;
  }

  async function deleteSession(id) {
    await db.remove('sessions', id);
  }

  async function setUnit(unit) {
    const settings = await App.queries.getSettings();
    settings.unit = unit;
    await db.put('settings', settings);
    return settings;
  }

  async function setBodyweight(value) {
    const settings = await App.queries.getSettings();
    settings.bodyweight = value;
    await db.put('settings', settings);
    return settings;
  }

  return {
    createWorkout, startWorkout, repeatLastWorkout, startFromSession, consolidateActiveWorkouts,
    addExerciseToWorkout, removeExerciseFromWorkout, reorderExercises,
    addSet, copyToNewSet, updateSet, isSetCompleted, deleteSet,
    finishWorkout, editWorkoutMeta, deleteWorkout,
    createExercise, archiveExercise,
    createSession, updateSession, deleteSession,
    setUnit, setBodyweight
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.commands;
