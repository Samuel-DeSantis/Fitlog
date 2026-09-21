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

  // The ONE thing a Session prescription is allowed to influence about a
  // Workout: how many blank, unconfirmed sets it starts with — one group
  // per exercise that has a targetSets value, at setOrder 0..targetSets-1.
  // repMin/repMax never touch a Set at all (they're reference-only, shown
  // — if at all — the same way previous performance already is), and
  // weight/reps here are always null, exactly like a set a user adds by
  // hand: nothing distinguishes a prescribed blank set from a freshly
  // "+ Add Set"-ed one once it exists, so every existing set-entry
  // behavior (copy-forward, confirm, edit, remove, the incomplete-set
  // finish warning, the "current set" highlight) already applies to it
  // with no changes needed anywhere else.
  // An exercise with no targetSets — still true for every Session created
  // before Phase 4.2 added an editor for it — simply gets none, so a
  // legacy/unprescribed Session starts a Workout exactly as it always
  // has.
  function buildPrescribedSets(workoutId, sessionExercises) {
    const sets = [];
    (sessionExercises || []).forEach((entry) => {
      const count = entry.targetSets;
      if (count == null || count <= 0) return;
      for (let i = 0; i < count; i++) {
        sets.push({
          id: utils.uuid(), workoutId, exerciseId: entry.exerciseId, setOrder: i,
          weight: null, reps: null, completedAt: null
        });
      }
    });
    return sets;
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
  //
  // fields.sessionExercises (optional, normalized {exerciseId, targetSets,
  // ...} entries) creates that session's prescribed blank sets alongside
  // the new workout, in the same transaction — but ONLY when a new
  // workout is actually created here; if an already-active workout is
  // returned instead (the conflict/resume case just below), nothing about
  // it is touched.
  //
  // fields.requireRelated (optional): by default, an already-active
  // workout is simply returned/resumed regardless of what it is — correct
  // for a free-form start, which has no particular workout to be related
  // or unrelated to. When true, that active workout is only treated as a
  // resume if its sessionId matches fields.sessionId; anything else
  // throws ActiveWorkoutConflictError instead, matching
  // startPlannedWorkout's own conflict behavior. Used by startFromSession
  // so starting a specific Session can never silently hand back an
  // unrelated active workout (e.g. Legs, while the person just tapped
  // Start on Upper Strength).
  async function resolveActiveWorkout(fields) {
    return db.runTransaction(['workouts', 'sets'], 'readwrite', async (tx) => {
      const store = tx.objectStore('workouts');
      const activeRows = await db.reqToPromise(store.index('status').getAll(IDBKeyRange.only('active')));
      if (activeRows.length > 1) {
        throw new App.errors.MultipleActiveWorkoutsError(activeRows);
      }
      if (activeRows.length === 1) {
        if (fields.requireRelated && activeRows[0].sessionId !== fields.sessionId) {
          throw new App.errors.ActiveWorkoutConflictError(activeRows[0]);
        }
        return activeRows[0];
      }
      const workout = buildWorkoutRecord(fields);
      store.put(workout);
      if (fields.sessionExercises) {
        const setsStore = tx.objectStore('sets');
        buildPrescribedSets(workout.id, fields.sessionExercises).forEach(s => setsStore.put(s));
      }
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

  // Same exercise structure as the Session — order and which exercises,
  // exactly as before. The prescription now ALSO seeds each exercise's
  // blank sets (buildPrescribedSets, via resolveActiveWorkout), but
  // still never touches the Workout's own structure beyond that: no
  // targetSets/repMin/repMax field ever lands on the workout or exists
  // on the exerciseOrder, and repMin/repMax never influence a Set at all
  // — only the count of blank sets to start with does.
  //
  // requireRelated: true — starting a SPECIFIC Session must not silently
  // resume an unrelated active workout (see resolveActiveWorkout); if one
  // is active, this throws ActiveWorkoutConflictError instead, unless
  // that active workout IS already this same session, in which case it's
  // a resume (equivalent in spirit to startPlannedWorkout resuming via
  // its entry.workoutId link — a Session-based start has no calendar
  // entry to link through, so sessionId is the relatedness check here).
  async function startFromSession(session) {
    const sessionExercises = App.prescriptions.normalizeListLenient(session.exercises);
    const exerciseIds = sessionExercises.map(e => e.exerciseId);
    return resolveActiveWorkout({
      title: session.name, exerciseIds, sessionId: session.id, sessionExercises,
      requireRelated: true
    });
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

  // exerciseIds accepts a mix of bare exerciseId strings (what the
  // Session editor sends today — Phase 4.2 will add prescription editing)
  // and full/partial {exerciseId, targetSets, repMin, repMax} objects;
  // App.prescriptions.normalizeList fills in null for anything unset and
  // throws on an invalid value rather than silently accepting it.
  async function createSession(name, exerciseIds, color) {
    const session = {
      id: utils.uuid(), name, exercises: App.prescriptions.normalizeList(exerciseIds),
      color: App.sessionColors.normalize(color),
      createdAt: utils.nowISO(), updatedAt: utils.nowISO()
    };
    await db.put('sessions', session);
    return session;
  }

  // Note on `exercises`: a bare exerciseId string in the incoming array
  // preserves that exercise's EXISTING prescription rather than resetting
  // it to null (App.prescriptions.mergeList) — the current Session editor
  // (Phase 4.2) always sends full structured objects, so this only
  // matters for other/legacy callers, but it must never be possible to
  // silently lose a prescription this way. A structured object always
  // wins outright for whichever exercise it names, even if that exercise
  // already had a prescription — see mergeList's own comment for why
  // that's a different rule than the bare-ID case.
  async function updateSession(id, fields) {
    const session = await db.get('sessions', id);
    if (!session) return null;
    const existingExercises = session.exercises;
    Object.assign(session, fields);
    if ('color' in fields) session.color = App.sessionColors.normalize(fields.color);
    if ('exercises' in fields) session.exercises = App.prescriptions.mergeList(existingExercises, fields.exercises);
    session.updatedAt = utils.nowISO();
    await db.put('sessions', session);
    return session;
  }

  // Sets (or clears, by passing nulls) the prescription for ONE exercise
  // already in the session, without needing to resupply the whole
  // exercises array. That exercise's position and every other exercise's
  // prescription are left untouched. This only ever writes to the
  // Session — it has no effect on any existing Workout or Set, and never
  // will: a prescription describes intent, never actual performance.
  async function updateSessionExercisePrescription(sessionId, exerciseId, fields) {
    const session = await db.get('sessions', sessionId);
    if (!session) return null;
    const exercises = App.prescriptions.normalizeList(session.exercises);
    const idx = exercises.findIndex(e => e.exerciseId === exerciseId);
    if (idx === -1) throw new Error('That exercise is not part of this session.');
    exercises[idx] = App.prescriptions.normalizeEntry({ ...exercises[idx], ...fields, exerciseId });
    session.exercises = exercises;
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
  //    workout (dated to the entry's planned date, not "today", so the
  //    calendar dot for that date simply flips from hollow to filled in
  //    place) and link it.
  // The whole check-then-act sequence (including the session lookup) runs
  // inside ONE transaction so two concurrent start attempts — on the same
  // entry, or on two different entries — can't both succeed.
  async function startPlannedWorkout(calendarEntryId) {
    return db.runTransaction(['calendarEntries', 'workouts', 'sessions', 'sets'], 'readwrite', async (tx) => {
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
      const session = rawSession
        ? { ...rawSession, color: App.sessionColors.normalize(rawSession.color), exercises: App.prescriptions.normalizeListLenient(rawSession.exercises) }
        : null;

      const workout = buildWorkoutRecord({
        title: session ? session.name : 'Workout',
        exerciseIds: session ? session.exercises.map(e => e.exerciseId) : [],
        sessionId: entry.sessionId,
        date: entry.date
      });
      workoutsStore.put(workout);

      if (session) {
        const setsStore = tx.objectStore('sets');
        buildPrescribedSets(workout.id, session.exercises).forEach(s => setsStore.put(s));
      }

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
  // editing any other completed workout. Also seeds the session's
  // prescribed blank sets, same as any other session-based start — the
  // backfilled workout is otherwise a normal (if already-completed)
  // workout, and blank/unconfirmed sets are exactly as valid to fill in
  // there as anywhere else.
  async function backfillWorkout(date, sessionId) {
    const session = sessionId ? await App.queries.getSession(sessionId) : null;
    return db.runTransaction(['workouts', 'sets'], 'readwrite', async (tx) => {
      const workout = buildWorkoutRecord({
        title: session ? session.name : 'Workout',
        exerciseIds: session ? session.exercises.map(e => e.exerciseId) : [],
        sessionId: sessionId || null,
        date
      });
      workout.status = 'completed';
      workout.endedAt = workout.startedAt;
      tx.objectStore('workouts').put(workout);

      if (session) {
        const setsStore = tx.objectStore('sets');
        buildPrescribedSets(workout.id, session.exercises).forEach(s => setsStore.put(s));
      }

      return workout;
    });
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
    createSession, updateSession, updateSessionExercisePrescription, deleteSession,
    planCalendarEntry, updateCalendarEntry, deleteCalendarEntry, startPlannedWorkout, backfillWorkout,
    setUnit, setBodyweight
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.commands;
