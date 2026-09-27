window.App = window.App || {};
App.cloud = App.cloud || {};

// Explicit, additive cloud backup (Phase 6 — see 6.6 in the brief).
//
// Deliberately NOT here: any notion of "delete from cloud because it's
// missing locally". Backup only ever upserts. There is no bidirectional
// reconciliation yet — that is out of scope for this phase (see
// docs/cloud-sync-notes.md for how a later phase could add it).
//
// Table/column naming: local records are camelCase (matching every
// other store in db.js); Supabase/Postgres convention is snake_case, so
// every field is explicitly renamed below rather than relying on any
// automatic case conversion — this is the one and only place that
// mapping is defined, in either direction (see restore.js for the
// inverse).
App.cloud.backup = (function () {
  // ---- local record -> cloud row, one mapper per store ----
  // Every mapper takes (record, userId) and ALWAYS stamps user_id from
  // the authenticated session — never from anything on the local
  // record — so a client can't spoof ownership even before RLS's own
  // (authoritative) `auth.uid() = user_id` check ever sees the request.
  function exerciseToRow(e, userId) {
    return {
      id: e.id,
      user_id: userId,
      name: e.name,
      primary_muscles: e.primaryMuscles || [],
      secondary_muscles: e.secondaryMuscles || [],
      equipment: e.equipment || '',
      movement_type: e.movementType || '',
      archived: !!e.archived,
      created_at: e.createdAt || null,
      updated_at: e.updatedAt || null
    };
  }

  // Session exercises/prescriptions are kept embedded (jsonb) rather
  // than split into a separate cloud table: locally they are likewise
  // just an array field on the Session record, never an independently
  // addressable entity, so a join table here would invent structure
  // the local data model doesn't have. Order in the array is the
  // exercise order, preserved as-is.
  function sessionToRow(s, userId) {
    return {
      id: s.id,
      user_id: userId,
      name: s.name,
      color: s.color,
      exercises: App.prescriptions.normalizeListLenient(s.exercises || []),
      created_at: s.createdAt || null,
      updated_at: s.updatedAt || null
    };
  }

  function workoutToRow(w, userId) {
    return {
      id: w.id,
      user_id: userId,
      session_id: w.sessionId || null,
      title: w.title,
      date: w.date,
      status: w.status,
      exercise_order: w.exerciseOrder || [],
      notes: w.notes || '',
      started_at: w.startedAt || null,
      ended_at: w.endedAt || null,
      created_at: w.createdAt || null,
      updated_at: w.updatedAt || null
    };
  }

  function setToRow(s, userId) {
    return {
      id: s.id,
      user_id: userId,
      workout_id: s.workoutId,
      exercise_id: s.exerciseId,
      set_order: s.setOrder,
      weight: s.weight,
      reps: s.reps,
      completed_at: s.completedAt || null,
      created_at: s.createdAt || null,
      updated_at: s.updatedAt || null
    };
  }

  function calendarEntryToRow(c, userId) {
    return {
      id: c.id,
      user_id: userId,
      date: c.date,
      session_id: c.sessionId || null,
      workout_id: c.workoutId || null,
      created_at: c.createdAt || null,
      updated_at: c.updatedAt || null
    };
  }

  // Settings is a singleton per user (unit + bodyweight), so it's keyed
  // by user_id in the cloud rather than carrying the local fixed id
  // 'app' along — that id has no meaning once more than one person's
  // data lives in the same table.
  //
  // updated_at reflects when the setting itself last actually changed
  // (stamped locally by setUnit/setBodyweight in commands.js), not when
  // this backup happened to run — a backup is a snapshot of existing
  // state, not a modification, so it must never manufacture a fresher
  // timestamp than the data actually has. The nowISO() fallback only
  // covers a legacy local settings record from before that stamping
  // existed and has never been touched since; it is not the normal case.
  function settingsToRow(s, userId) {
    return {
      user_id: userId,
      unit: (s && s.unit) || 'lb',
      bodyweight: (s && s.bodyweight != null) ? s.bodyweight : null,
      updated_at: (s && s.updatedAt) || App.utils.nowISO()
    };
  }

  // storeName (as in db.js's STORES) -> { cloudTable, conflictTarget, toRow }
  const TABLE_CONFIG = {
    exercises: { cloudTable: 'exercises', conflictTarget: 'id', toRow: exerciseToRow },
    sessions: { cloudTable: 'sessions', conflictTarget: 'id', toRow: sessionToRow },
    workouts: { cloudTable: 'workouts', conflictTarget: 'id', toRow: workoutToRow },
    sets: { cloudTable: 'sets', conflictTarget: 'id', toRow: setToRow },
    calendarEntries: { cloudTable: 'calendar_entries', conflictTarget: 'id', toRow: calendarEntryToRow },
    settings: { cloudTable: 'user_settings', conflictTarget: 'user_id', toRow: settingsToRow }
  };

  // Dependency order matters for real Postgres foreign keys: exercises
  // and sessions never reference another user-owned table, workouts
  // reference sessions, sets reference workouts+exercises, and
  // calendarEntries reference both sessions and workouts. Backing up in
  // this order means every FK a row points at already exists by the
  // time that row is upserted.
  const BACKUP_ORDER = ['exercises', 'sessions', 'workouts', 'sets', 'calendarEntries', 'settings'];

  // Uploads everything currently in IndexedDB for the signed-in user.
  // Pure upsert (onConflict on the stable local id, or user_id for the
  // settings singleton) — never a delete, per the "additive, not
  // reconciling" rule above. onProgress(storeName, rowCount) is
  // optional, purely informational (e.g. for a progress line in the UI).
  async function backupAll(onProgress) {
    const client = App.cloud.getClient();
    const user = App.cloud.auth.getUser();
    if (!client || !user) {
      throw new App.errors.CloudUnavailableError('Sign in to back up your data to the cloud.');
    }

    const exported = await App.db.exportAll();
    const counts = {};

    for (const storeName of BACKUP_ORDER) {
      const config = TABLE_CONFIG[storeName];
      const records = exported.stores[storeName] || [];

      if (storeName === 'settings') {
        // Singleton: back up the one settings record if it exists, or
        // skip entirely on a completely fresh install (nothing to
        // upsert, and nothing to error about either).
        if (!records.length) { counts[storeName] = 0; continue; }
        const row = config.toRow(records[0], user.id);
        const { error } = await client.from(config.cloudTable).upsert(row, { onConflict: config.conflictTarget });
        if (error) throw new App.errors.CloudSyncError(storeName, error);
        counts[storeName] = 1;
        if (onProgress) onProgress(storeName, 1);
        continue;
      }

      if (!records.length) { counts[storeName] = 0; if (onProgress) onProgress(storeName, 0); continue; }
      const rows = records.map(r => config.toRow(r, user.id));
      const { error } = await client.from(config.cloudTable).upsert(rows, { onConflict: config.conflictTarget });
      if (error) throw new App.errors.CloudSyncError(storeName, error);
      counts[storeName] = rows.length;
      if (onProgress) onProgress(storeName, rows.length);
    }

    return counts;
  }

  return {
    backupAll,
    // exported for the restore module (kept as the single source of
    // truth for table/column naming) and for direct unit testing.
    TABLE_CONFIG, BACKUP_ORDER,
    exerciseToRow, sessionToRow, workoutToRow, setToRow, calendarEntryToRow, settingsToRow
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.cloud.backup;
