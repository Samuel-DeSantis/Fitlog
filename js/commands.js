window.App = window.App || {};

App.commands = (function () {
  const db = App.db;
  const utils = App.utils;

  function buildWorkoutRecord(opts) {
    opts = opts || {};
    return {
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
  }

  // Unguarded primitive — always creates. Used internally by editing flows
  // and directly by tests that need a workout regardless of active-state.
  // The UI never calls this for "start a workout"; see resolveActiveWorkout.
  async function createWorkout(opts) {
    const workout = buildWorkoutRecord(opts);
    await db.put('workouts', workout);
    return workout;
  }

  // The atomic core of the active-workout invariant. The "is there already
  // an active workout" check and the "create one" write happen inside a
  // SINGLE IndexedDB transaction on the workouts store, so two concurrent
  // calls cannot both see "no active workout" and both create one — the
  // second transaction is serialized behind the first and sees its result.
  //
  // If more than one active workout is ever found (only possible from
  // corrupted or pre-fix imported data, never from normal use now), this
  // does NOT silently pick one or repair anything — it throws, and the
  // caller is responsible for surfacing that explicitly.
  async function resolveActiveWorkout(fields) {
    return db.runTransaction(['workouts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('workouts');
      const activeRows = await db.reqToPromise(store.index('status').getAll(IDBKeyRange.only('active')));
      if (activeRows.length > 1) {
        throw new App.errors.MultipleActiveWorkoutsError(activeRows);
      }
      if (activeRows.length === 1) return activeRows[0];
      const workout = buildWorkoutRecord(fields);
      store.put(workout);
      return workout;
    });
  }

  // The ONLY path the UI should use to start a workout.
  async function startWorkout(title, exerciseIds, sessionId) {
    return resolveActiveWorkout({ title, exerciseIds, sessionId: sessionId || null });
  }

  // Same exercise structure as the last completed workout. Copies NO
  // numbers — previous performance stays visible as reference only.
  async function repeatLastWorkout() {
    const last = await App.queries.getLatestCompletedWorkout();
    if (!last) return App.queries.getActiveWorkout();
    return resolveActiveWorkout({ title: last.title, exerciseIds: last.exerciseOrder, sessionId: last.sessionId });
  }

  async function startFromSession(session) {
    return resolveActiveWorkout({ title: session.name, exerciseIds: session.exercises, sessionId: session.id });
  }

  // Every command that modifies an existing workout goes through this: the
  // read and the write happen inside ONE transaction, so the mutation is
  // always applied to the current committed state — never to a snapshot
  // fetched earlier via a separate db.get(). Without this, two commands
  // firing close together (a re-render kicking off a new action before a
  // prior one's write lands, or just fast double-tapping) could each read
  // the same stale copy and the second write would silently discard the
  // first's change. Concurrent transactions on the 'workouts' store are
  // serialized by IndexedDB, so whichever runs second always sees the
  // first's committed result.
  async function mutateWorkout(workoutId, mutateFn) {
    return db.runTransaction(['workouts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('workouts');
      const workout = await db.reqToPromise(store.get(workoutId));
      if (!workout) return null;
      mutateFn(workout);
      workout.updatedAt = utils.nowISO();
      store.put(workout);
      return workout;
    });
  }

  async function addExerciseToWorkout(workoutId, exerciseId) {
    return mutateWorkout(workoutId, (workout) => {
      if (!workout.exerciseOrder.includes(exerciseId)) {
        workout.exerciseOrder = [...workout.exerciseOrder, exerciseId];
      }
    });
  }

  // Transactional: the workout's exerciseOrder update and the deletion of
  // that exercise's sets commit together or not at all.
  async function removeExerciseFromWorkout(workoutId, exerciseId) {
    return db.runTransaction(['workouts', 'sets'], 'readwrite', async (tx) => {
      const workoutStore = tx.objectStore('workouts');
      const workout = await db.reqToPromise(workoutStore.get(workoutId));
      if (!workout) return null;
      workout.exerciseOrder = workout.exerciseOrder.filter(id => id !== exerciseId);
      workout.updatedAt = utils.nowISO();
      workoutStore.put(workout);

      const setsStore = tx.objectStore('sets');
      const allSets = await db.reqToPromise(setsStore.index('workoutId').getAll(IDBKeyRange.only(workoutId)));
      allSets.filter(s => s.exerciseId === exerciseId).forEach(s => setsStore.delete(s.id));

      return workout;
    });
  }

  async function reorderExercises(workoutId, orderedExerciseIds) {
    return mutateWorkout(workoutId, (workout) => {
      workout.exerciseOrder = [...orderedExerciseIds];
    });
  }

  // Adds a set. If the exercise already has a set in this workout with
  // valid weight/reps, copies the most recent such set's values as a
  // starting point (looking backward past any incomplete/blank sets if
  // needed) — but the new set is NEVER marked completed just because it
  // has values; completedAt stays null until the user explicitly confirms
  // it (either by editing a value, which re-triggers the normal
  // completion rule below, or via setSetCompleted()).
  // The read-scan-then-write is inside one transaction so two concurrent
  // "add set" taps can't compute the same setOrder.
  async function addSet(workoutId, exerciseId) {
    return db.runTransaction(['sets'], 'readwrite', async (tx) => {
      const store = tx.objectStore('sets');
      const forWorkout = await db.reqToPromise(store.index('workoutId').getAll(IDBKeyRange.only(workoutId)));
      const forExercise = forWorkout.filter(s => s.exerciseId === exerciseId).sort((a, b) => a.setOrder - b.setOrder);

      let copyWeight = null, copyReps = null;
      for (let i = forExercise.length - 1; i >= 0; i--) {
        const s = forExercise[i];
        if (s.weight != null && s.reps != null) {
          copyWeight = s.weight;
          copyReps = s.reps;
          break;
        }
      }

      const set = {
        id: utils.uuid(), workoutId, exerciseId, setOrder: forExercise.length,
        weight: copyWeight, reps: copyReps, completedAt: null
      };
      store.put(set);
      return set;
    });
  }

  // completedAt is derived, not assumed: typing a value sets it the
  // instant both weight and reps are present (this is what makes a
  // freshly-typed blank set complete without a separate confirm step),
  // and clears it if either is removed. A set that already had both
  // values from being copied — untouched by the user — keeps whatever
  // completedAt it had (null, until explicitly confirmed).
  async function updateSet(setId, fields) {
    const set = await db.get('sets', setId);
    if (!set) return null;
    if ('weight' in fields) set.weight = fields.weight;
    if ('reps' in fields) set.reps = fields.reps;
    set.completedAt = (set.weight != null && set.reps != null) ? (set.completedAt || utils.nowISO()) : null;
    await db.put('sets', set);
    return set;
  }

  // Explicit confirm/un-confirm — the only way a set with copied-but-
  // untouched values becomes completed without the user re-typing them.
  // Can't complete a set that's missing weight or reps.
  async function setSetCompleted(setId, completed) {
    const set = await db.get('sets', setId);
    if (!set) return null;
    if (completed && (set.weight == null || set.reps == null)) return set;
    set.completedAt = completed ? (set.completedAt || utils.nowISO()) : null;
    await db.put('sets', set);
    return set;
  }

  // The authoritative completion check — completedAt, not merely "has
  // values", since a copied set can have both without being confirmed.
  function isSetCompleted(set) {
    return set.completedAt != null;
  }

  async function deleteSet(setId) {
    await db.remove('sets', setId);
  }

  async function finishWorkout(workoutId) {
    return mutateWorkout(workoutId, (workout) => {
      workout.status = 'completed';
      workout.endedAt = utils.nowISO();
    });
  }

  // If this workout originated from a planned Calendar Entry and its date
  // changes, the entry's date moves with it — otherwise the plan would
  // keep pointing at the old date while the workout it represents now
  // lives on a different one. Only the `date` field cascades; title/notes
  // edits never touch the calendar entry. Done in the same transaction as
  // the workout update so the two can't end up disagreeing.
  async function editWorkoutMeta(workoutId, fields) {
    return db.runTransaction(['workouts', 'calendarEntries'], 'readwrite', async (tx) => {
      const workoutsStore = tx.objectStore('workouts');
      const workout = await db.reqToPromise(workoutsStore.get(workoutId));
      if (!workout) return null;

      Object.assign(workout, fields);
      workout.updatedAt = utils.nowISO();
      workoutsStore.put(workout);

      if ('date' in fields) {
        const entriesStore = tx.objectStore('calendarEntries');
        const allEntries = await db.reqToPromise(entriesStore.getAll());
        const linked = allEntries.find(e => e.workoutId === workoutId);
        if (linked && linked.date !== workout.date) {
          linked.date = workout.date;
          linked.updatedAt = utils.nowISO();
          entriesStore.put(linked);
        }
      }

      return workout;
    });
  }

  // Transactional: sets and the workout row are deleted together, or not
  // at all — no partially-deleted state possible.
  async function deleteWorkout(workoutId) {
    await db.runTransaction(['workouts', 'sets'], 'readwrite', async (tx) => {
      const setsStore = tx.objectStore('sets');
      const sets = await db.reqToPromise(setsStore.index('workoutId').getAll(IDBKeyRange.only(workoutId)));
      sets.forEach(s => setsStore.delete(s.id));
      tx.objectStore('workouts').delete(workoutId);
    });
  }

  async function createExercise(name, options) {
    options = options || {};
    const ex = {
      id: utils.uuid(), name,
      primaryMuscles: options.primaryMuscles || [],
      secondaryMuscles: options.secondaryMuscles || [],
      equipment: options.equipment || '',
      movementType: options.movementType || '',
      archived: false, createdAt: utils.nowISO(), updatedAt: utils.nowISO()
    };
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

  async function createSession(name, exerciseIds, color) {
    const session = {
      id: utils.uuid(), name, exercises: [...exerciseIds],
      color: App.sessionColors.normalize(color),
      createdAt: utils.nowISO(), updatedAt: utils.nowISO()
    };
    await db.put('sessions', session);
    return session;
  }

  async function updateSession(id, fields) {
    const session = await db.get('sessions', id);
    if (!session) return null;
    Object.assign(session, fields);
    if ('color' in fields) session.color = App.sessionColors.normalize(fields.color);
    session.updatedAt = utils.nowISO();
    await db.put('sessions', session);
    return session;
  }

  async function deleteSession(id) {
    await db.remove('sessions', id);
  }

  // Creates a planned occurrence — NOT a Workout. Multiple plans on the
  // same date, and a plan coexisting with completed workouts on the same
  // date, are both fine; there's no active-workout-style invariant here.
  async function planCalendarEntry(date, sessionId) {
    const entry = {
      id: utils.uuid(), date, sessionId: sessionId || null, workoutId: null,
      createdAt: utils.nowISO(), updatedAt: utils.nowISO()
    };
    await db.put('calendarEntries', entry);
    return entry;
  }

  async function updateCalendarEntry(id, fields) {
    const entry = await db.get('calendarEntries', id);
    if (!entry) return null;
    Object.assign(entry, fields, { updatedAt: utils.nowISO() });
    await db.put('calendarEntries', entry);
    return entry;
  }

  // Only removes the plan record itself — never touches the Session it
  // references or any workout it may have produced. Cancelling a plan
  // must not be able to delete either of those.
  async function deleteCalendarEntry(id) {
    await db.remove('calendarEntries', id);
  }

  // Starts (or resumes) the Workout for a planned Calendar Entry, without
  // ever creating a second one for the same entry:
  //  - If the entry is already linked to a workout that still exists,
  //    that link is authoritative — just return it (covers "tapped Start,
  //    navigated away, came back and tapped Start again").
  //  - Otherwise resolve/create via the same guarded path every other
  //    "start a workout" action uses, then record the link.
  // The new workout is dated to match the entry's planned date (not
  // "today"), so the calendar dot for that date simply flips from hollow
  // to filled in place, matching what the user planned regardless of the
  // exact moment they actually pressed Start.
  // Starts (or resumes) the Workout for a planned Calendar Entry:
  //  - If the entry is already linked to a workout that still exists,
  //    that link is authoritative — just return it (covers "tapped Start,
  //    navigated away, came back and tapped Start again").
  //  - Otherwise, this entry has no workout of its own yet. If some OTHER
  //    workout is already active at this point, it is by definition
  //    unrelated to this entry — refuse rather than silently attaching
  //    the plan to it, and let the caller tell the user to finish/resume
  //    it first.
  //  - Only when neither of the above applies does this create a new
  //    workout and link it.
  // The whole check-then-act sequence (including the session lookup) runs
  // inside ONE transaction so two concurrent start attempts — on the same
  // entry, or on two different entries — can't both succeed.
  async function startPlannedWorkout(calendarEntryId) {
    return db.runTransaction(['calendarEntries', 'workouts', 'sessions'], 'readwrite', async (tx) => {
      const entriesStore = tx.objectStore('calendarEntries');
      const workoutsStore = tx.objectStore('workouts');
      const sessionsStore = tx.objectStore('sessions');

      const entry = await db.reqToPromise(entriesStore.get(calendarEntryId));
      if (!entry) return null;

      if (entry.workoutId) {
        const existing = await db.reqToPromise(workoutsStore.get(entry.workoutId));
        if (existing) return { entry, workout: existing };
      }

      const activeRows = await db.reqToPromise(workoutsStore.index('status').getAll(IDBKeyRange.only('active')));
      if (activeRows.length > 1) {
        throw new App.errors.MultipleActiveWorkoutsError(activeRows);
      }
      if (activeRows.length === 1) {
        throw new App.errors.ActiveWorkoutConflictError(activeRows[0]);
      }

      const rawSession = entry.sessionId ? await db.reqToPromise(sessionsStore.get(entry.sessionId)) : null;
      const session = rawSession ? { ...rawSession, color: App.sessionColors.normalize(rawSession.color) } : null;

      const workout = buildWorkoutRecord({
        title: session ? session.name : 'Workout',
        exerciseIds: session ? session.exercises : [],
        sessionId: entry.sessionId,
        date: entry.date
      });
      workoutsStore.put(workout);

      entry.workoutId = workout.id;
      entry.updatedAt = utils.nowISO();
      entriesStore.put(entry);

      return { entry, workout };
    });
  }

  // Backfills a past (or today's) workout directly as completed — it
  // never touches the active-workout slot, so it can be created even
  // while a different workout is currently active. Reuses the same
  // workout screen for data entry: once created, it opens exactly like
  // editing any other completed workout.
  async function backfillWorkout(date, sessionId) {
    const session = sessionId ? await App.queries.getSession(sessionId) : null;
    const workout = buildWorkoutRecord({
      title: session ? session.name : 'Workout',
      exerciseIds: session ? session.exercises : [],
      sessionId: sessionId || null,
      date
    });
    workout.status = 'completed';
    workout.endedAt = workout.startedAt;
    await db.put('workouts', workout);
    return workout;
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
    createWorkout, startWorkout, repeatLastWorkout, startFromSession,
    addExerciseToWorkout, removeExerciseFromWorkout, reorderExercises,
    addSet, updateSet, isSetCompleted, setSetCompleted, deleteSet,
    finishWorkout, editWorkoutMeta, deleteWorkout,
    createExercise, archiveExercise,
    createSession, updateSession, deleteSession,
    planCalendarEntry, updateCalendarEntry, deleteCalendarEntry, startPlannedWorkout, backfillWorkout,
    setUnit, setBodyweight
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.commands;
