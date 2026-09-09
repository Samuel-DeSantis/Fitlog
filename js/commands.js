window.App = window.App || {};

App.commands = (function () {
  const db = App.db;
  const utils = App.utils;

  async function createWorkout(title, exerciseIds) {
    exerciseIds = exerciseIds || [];
    const workout = {
      id: utils.uuid(),
      date: utils.todayLocalISO(),
      title: title || 'Workout',
      notes: '',
      status: 'in_progress',
      startedAt: utils.nowISO(),
      endedAt: null,
      createdAt: utils.nowISO(),
      updatedAt: utils.nowISO()
    };
    await db.put('workouts', workout);
    for (let i = 0; i < exerciseIds.length; i++) {
      await addExerciseToWorkout(workout.id, exerciseIds[i], i);
    }
    return workout;
  }

  async function addExerciseToWorkout(workoutId, exerciseId, order) {
    if (order == null) {
      const existing = await App.queries.getWorkoutExercises(workoutId);
      order = existing.length;
    }
    const we = { id: utils.uuid(), workoutId, exerciseId, order, note: '', createdAt: utils.nowISO() };
    await db.put('workoutExercises', we);
    return we;
  }

  async function removeExerciseFromWorkout(workoutExerciseId) {
    const sets = await App.queries.getSetsForWorkoutExercise(workoutExerciseId);
    for (const s of sets) await db.remove('sets', s.id);
    await db.remove('workoutExercises', workoutExerciseId);
  }

  async function reorderWorkoutExercises(workoutId, orderedWorkoutExerciseIds) {
    for (let i = 0; i < orderedWorkoutExerciseIds.length; i++) {
      const we = await db.get('workoutExercises', orderedWorkoutExerciseIds[i]);
      if (we) {
        we.order = i;
        await db.put('workoutExercises', we);
      }
    }
  }

  // Adds a blank set. Never pre-fills weight/reps — that requires an
  // explicit copyPreviousToSet() call from the UI.
  async function addEmptySet(workoutExercise) {
    const existing = await App.queries.getSetsForWorkoutExercise(workoutExercise.id);
    const set = {
      id: utils.uuid(),
      workoutId: workoutExercise.workoutId,
      workoutExerciseId: workoutExercise.id,
      exerciseId: workoutExercise.exerciseId,
      setIndex: existing.length,
      weight: null,
      reps: null,
      rpe: null,
      createdAt: utils.nowISO(),
      updatedAt: utils.nowISO()
    };
    await db.put('sets', set);
    return set;
  }

  // Explicit copy of a specific prior set's numbers into a new set today.
  async function copyPreviousToNewSet(workoutExercise, previousSet) {
    const set = await addEmptySet(workoutExercise);
    return updateSet(set.id, { weight: previousSet.weight, reps: previousSet.reps });
  }

  async function updateSet(setId, fields) {
    const set = await db.get('sets', setId);
    if (!set) return null;
    if ('weight' in fields) set.weight = fields.weight;
    if ('reps' in fields) set.reps = fields.reps;
    if ('rpe' in fields) set.rpe = fields.rpe;
    set.updatedAt = utils.nowISO();
    await db.put('sets', set);
    return set;
  }

  async function deleteSet(setId) {
    await db.remove('sets', setId);
  }

  // A set counts as completed once it has both numbers — never merely
  // because the row exists.
  function isSetCompleted(set) {
    return set.weight != null && set.reps != null;
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

  async function cancelWorkout(workoutId) {
    const workoutExercises = await App.queries.getWorkoutExercises(workoutId);
    for (const we of workoutExercises) {
      await removeExerciseFromWorkout(we.id);
    }
    await db.remove('workouts', workoutId);
  }

  async function editWorkoutMeta(workoutId, fields) {
    const workout = await db.get('workouts', workoutId);
    if (!workout) return null;
    Object.assign(workout, fields, { updatedAt: utils.nowISO() });
    await db.put('workouts', workout);
    return workout;
  }

  // Same exercise structure as the last completed workout. Deliberately
  // copies NO numbers — previous performance stays visible as reference,
  // not as pre-filled "already done" sets. Goes through startWorkout() so
  // it can never create a second active workout if one already exists.
  async function repeatLastWorkout() {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    const last = await App.queries.getLatestCompletedWorkout();
    if (!last) return null;
    const lastExercises = await App.queries.getWorkoutExercises(last.id);
    const exerciseIds = lastExercises.map(we => we.exerciseId);
    return createWorkout(last.title, exerciseIds);
  }

  async function startFromTemplate(template) {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    const exerciseIds = [...template.exercises].sort((a, b) => a.order - b.order).map(e => e.exerciseId);
    return createWorkout(template.name, exerciseIds);
  }

  // Idempotent entry point for a plain "New Workout" action. If an active
  // workout already exists — including the double-tap/race case where two
  // start actions fire before the first write lands — this resumes it
  // instead of creating a duplicate.
  async function startWorkout(title, exerciseIds) {
    const active = await App.queries.getActiveWorkout();
    if (active) return active;
    return createWorkout(title, exerciseIds);
  }

  // If duplicate active workouts exist (e.g. from a past double-tap before
  // this guard existed), keep the most recently started one active and mark
  // the rest completed — never delete their sets. Their logged data then
  // shows up normally in Progress/history instead of silently vanishing.
  async function consolidateActiveWorkouts() {
    const rows = await db.getAllByIndexRange('workouts', 'status', IDBKeyRange.only('in_progress'));
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

  async function saveTemplateFromWorkout(workoutId, name) {
    const workoutExercises = await App.queries.getWorkoutExercises(workoutId);
    const template = {
      id: utils.uuid(),
      name,
      exercises: workoutExercises.map(we => ({ exerciseId: we.exerciseId, order: we.order })),
      createdAt: utils.nowISO()
    };
    await db.put('templates', template);
    return template;
  }

  // Nutrition is one record per day. Only fields explicitly passed are
  // changed — omitted fields keep whatever was already logged that day,
  // so a second entry later in the day (e.g. logging protein after
  // logging calories) never zeroes out the first.
  async function upsertNutritionForDate(date, fields) {
    const existing = await db.get('nutritionLogs', date);
    const base = existing || { id: date, date, calories: 0, protein: 0, carbs: 0, fat: 0, water: 0, note: '' };
    const record = Object.assign({}, base, fields, { updatedAt: utils.nowISO() });
    await db.put('nutritionLogs', record);
    return record;
  }

  async function addBodyweight(date, weight) {
    const entry = { id: utils.uuid(), date, weight, createdAt: utils.nowISO() };
    await db.put('bodyweightLogs', entry);
    return entry;
  }

  async function addSleep(date, durationMin) {
    const entry = { id: utils.uuid(), date, durationMin, createdAt: utils.nowISO() };
    await db.put('sleepLogs', entry);
    return entry;
  }

  async function addMeasurement(date, type, value) {
    const entry = { id: utils.uuid(), date, type, value, createdAt: utils.nowISO() };
    await db.put('measurements', entry);
    return entry;
  }

  async function addNote(date, text) {
    const entry = { id: utils.uuid(), date, text, createdAt: utils.nowISO() };
    await db.put('notes', entry);
    return entry;
  }

  // Archiving preserves the record (and every historical reference to it)
  // — it only hides the exercise from future pickers.
  async function archiveExercise(exerciseId) {
    const ex = await db.get('exercises', exerciseId);
    if (!ex) return null;
    ex.archived = true;
    ex.updatedAt = utils.nowISO();
    await db.put('exercises', ex);
    return ex;
  }

  async function createExercise(name, category, equipment) {
    const ex = {
      id: utils.uuid(), name, category: category || 'Other', equipment: equipment || '',
      archived: false, createdAt: utils.nowISO(), updatedAt: utils.nowISO()
    };
    await db.put('exercises', ex);
    return ex;
  }

  async function setUnit(unit) {
    const settings = (await db.get('settings', 'app')) || { id: 'app' };
    settings.unit = unit;
    await db.put('settings', settings);
    return settings;
  }

  return {
    createWorkout, startWorkout, consolidateActiveWorkouts,
    addExerciseToWorkout, removeExerciseFromWorkout, reorderWorkoutExercises,
    addEmptySet, copyPreviousToNewSet, updateSet, deleteSet, isSetCompleted,
    finishWorkout, cancelWorkout, editWorkoutMeta,
    repeatLastWorkout, startFromTemplate, saveTemplateFromWorkout,
    upsertNutritionForDate, addBodyweight, addSleep, addMeasurement, addNote,
    archiveExercise, createExercise, setUnit
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.commands;
