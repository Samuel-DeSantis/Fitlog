window.App = window.App || {};
App.cloud = App.cloud || {};

// Explicit cloud restore (Phase 6 — see 6.7 in the brief).
//
//   Supabase -> map to local shape -> App.db.importAll -> IndexedDB
//
// Deliberately reuses App.db.importAll rather than writing a second,
// parallel IndexedDB writer: that function already validates shape,
// normalizes legacy records, and applies every store's writes in one
// atomic transaction (see db.js). Cloud restore gets all of that for
// free, and there's exactly one place that knows how to safely write
// an export-shaped payload into IndexedDB.
App.cloud.restore = (function () {
  // ---- cloud row -> local record, the inverse of backup.js's mappers ----
  function rowToExercise(r) {
    return {
      id: r.id,
      name: r.name,
      primaryMuscles: r.primary_muscles || [],
      secondaryMuscles: r.secondary_muscles || [],
      equipment: r.equipment || '',
      movementType: r.movement_type || '',
      archived: !!r.archived,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  function rowToSession(r) {
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      exercises: r.exercises || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  function rowToWorkout(r) {
    return {
      id: r.id,
      sessionId: r.session_id,
      title: r.title,
      date: r.date,
      status: r.status,
      exerciseOrder: r.exercise_order || [],
      notes: r.notes || '',
      startedAt: r.started_at,
      endedAt: r.ended_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  function rowToSet(r) {
    return {
      id: r.id,
      workoutId: r.workout_id,
      exerciseId: r.exercise_id,
      setOrder: r.set_order,
      weight: r.weight,
      reps: r.reps,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  function rowToCalendarEntry(r) {
    return {
      id: r.id,
      date: r.date,
      sessionId: r.session_id,
      workoutId: r.workout_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  function rowToSettings(r) {
    return {
      id: 'app', unit: r.unit || 'lb', bodyweight: r.bodyweight != null ? r.bodyweight : null,
      updatedAt: r.updated_at
    };
  }

  const ROW_TO_LOCAL = {
    exercises: rowToExercise,
    sessions: rowToSession,
    workouts: rowToWorkout,
    sets: rowToSet,
    calendarEntries: rowToCalendarEntry,
    settings: rowToSettings
  };

  // Fetches every row this user owns across every cloud table and
  // reshapes it into the same { meta, stores } payload App.db.exportAll
  // produces / App.db.importAll consumes — so restore is really just
  // "import a backup that happens to come from Supabase instead of a
  // JSON file".
  async function fetchCloudSnapshot() {
    const client = App.cloud.getClient();
    const user = App.cloud.auth.getUser();
    if (!client || !user) {
      throw new App.errors.CloudUnavailableError('Sign in to restore your data from the cloud.');
    }

    const config = App.cloud.backup.TABLE_CONFIG;
    const stores = {};

    for (const storeName of Object.keys(ROW_TO_LOCAL)) {
      const { cloudTable } = config[storeName];
      const { data, error } = await client.from(cloudTable).select('*').eq('user_id', user.id);
      if (error) throw new App.errors.CloudSyncError(storeName, error);
      stores[storeName] = (data || []).map(ROW_TO_LOCAL[storeName]);
    }

    return { meta: { formatVersion: App.db.FORMAT_VERSION, exportedAt: App.utils.nowISO() }, stores };
  }

  // mode: 'merge' (default, additive — matches the existing JSON
  // import's merge behavior) or 'replace' (destructive: clears local
  // data first). The UI is responsible for getting explicit user
  // confirmation before ever calling this with 'replace' — see
  // views/more.js. Malformed cloud data (missing required fields,
  // wrong shapes) is caught by App.db.importAll's own validation and
  // rejected before anything is written, exactly as a bad JSON import
  // file already is.
  async function restoreAll(mode) {
    const snapshot = await fetchCloudSnapshot();
    await App.db.importAll(snapshot, mode || 'merge');
    return snapshot;
  }

  return {
    fetchCloudSnapshot, restoreAll,
    rowToExercise, rowToSession, rowToWorkout, rowToSet, rowToCalendarEntry, rowToSettings
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.cloud.restore;
