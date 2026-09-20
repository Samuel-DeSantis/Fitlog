window.App = window.App || {};

App.db = (function () {
  const DB_NAME = 'fitlog_v2';
  const DB_VERSION = 4;
  const FORMAT_VERSION = 1;
  const STORES = ['exercises', 'sessions', 'workouts', 'sets', 'calendarEntries', 'settings'];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        const oldVersion = e.oldVersion;

        if (!db.objectStoreNames.contains('exercises')) {
          const s = db.createObjectStore('exercises', { keyPath: 'id' });
          s.createIndex('name', 'name');
          s.createIndex('archived', 'archived');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('workouts')) {
          const s = db.createObjectStore('workouts', { keyPath: 'id' });
          s.createIndex('date', 'date');
          s.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('sets')) {
          const s = db.createObjectStore('sets', { keyPath: 'id' });
          s.createIndex('workoutId', 'workoutId');
          s.createIndex('exerciseId', 'exerciseId');
        }
        if (!db.objectStoreNames.contains('calendarEntries')) {
          const s = db.createObjectStore('calendarEntries', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }

        // v1 -> v2: Sessions gained a `color` field for Calendar dots.
        // Existing sessions predate this and have no color — backfill a
        // default so nothing renders with an undefined color. No stores
        // change shape otherwise, and no existing data is touched beyond
        // this one additive field.
        if (oldVersion > 0 && oldVersion < 2) {
          const sessionsStore = tx.objectStore('sessions');
          sessionsStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const session = cursor.value;
            if (!session.color) {
              session.color = 'gray';
              cursor.update(session);
            }
            cursor.continue();
          };
        }

        // v2 -> v3: Exercises gained primaryMuscles/secondaryMuscles/
        // equipment/movementType for the picker's search & muscle-group
        // filtering. Existing exercises predate this — backfill by
        // matching name against the known seed library; anything that
        // doesn't match (a user's own custom exercise) gets empty
        // defaults rather than a guessed category. IDs and every other
        // field are untouched, so Sessions/Workouts/Sets/Calendar Entries
        // referencing these exercises are completely unaffected.
        if (oldVersion > 0 && oldVersion < 3) {
          const exercisesStore = tx.objectStore('exercises');
          const metadataByName = {};
          (App.exerciseSeedData || []).forEach((e) => { metadataByName[e.name] = e; });
          exercisesStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const ex = cursor.value;
            if (ex.primaryMuscles === undefined) {
              const meta = metadataByName[ex.name];
              ex.primaryMuscles = meta ? meta.primaryMuscles : [];
              ex.secondaryMuscles = meta ? meta.secondaryMuscles : [];
              ex.equipment = meta ? meta.equipment : (ex.equipment || '');
              ex.movementType = meta ? meta.movementType : '';
              cursor.update(ex);
            }
            cursor.continue();
          };
        }

        // v3 -> v4 (Phase 4.1): Session exercises gained an optional
        // training prescription (targetSets/repMin/repMax) alongside the
        // exerciseId they always had. Existing sessions predate this and
        // store plain exerciseId strings — normalize every entry into the
        // full {exerciseId, targetSets, repMin, repMax} shape (unset
        // fields become null, meaning "no prescription yet"), so every
        // consumer can rely on one consistent shape regardless of which
        // version a session was created under. Session id, name, color,
        // exercise order, and every exerciseId are preserved exactly —
        // only the shape of each exercises[] entry changes. This touches
        // only the sessions store: Workouts, Sets, and Calendar Entries
        // (and the actual historical performance they hold) are
        // completely untouched by this migration.
        if (oldVersion > 0 && oldVersion < 4) {
          const sessionsStore = tx.objectStore('sessions');
          sessionsStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const session = cursor.value;
            session.exercises = App.prescriptions.normalizeList(session.exercises || []);
            cursor.update(session);
            cursor.continue();
          };
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Generic escape hatch for compound operations that must be atomic
  // (e.g. "check for an active workout and create one if not" or "delete
  // a workout and its sets together"). `work` receives the raw transaction
  // so the caller can issue multiple requests against it using
  // reqToPromise(); they either all commit together or the whole
  // transaction aborts. This is the ONLY place multi-store atomicity is
  // implemented — callers never manage transactions themselves beyond this.
  async function runTransaction(storeNames, mode, work) {
    const database = await open();
    const tx = database.transaction(storeNames, mode);
    const donePromise = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
    const result = await work(tx);
    await donePromise;
    return result;
  }

  async function put(store, value) {
    const db = await open();
    const t = db.transaction([store], 'readwrite');
    return reqToPromise(t.objectStore(store).put(value));
  }

  async function get(store, key) {
    const db = await open();
    const t = db.transaction([store], 'readonly');
    return reqToPromise(t.objectStore(store).get(key));
  }

  async function getAll(store) {
    const db = await open();
    const t = db.transaction([store], 'readonly');
    return reqToPromise(t.objectStore(store).getAll());
  }

  // Indexed lookup — the default for anything scoped to one workout,
  // exercise, date range, or status. Range may be omitted for "all".
  async function getAllByIndexRange(store, indexName, range) {
    const db = await open();
    const t = db.transaction([store], 'readonly');
    return reqToPromise(t.objectStore(store).index(indexName).getAll(range));
  }

  async function remove(store, key) {
    const db = await open();
    const t = db.transaction([store], 'readwrite');
    await reqToPromise(t.objectStore(store).delete(key));
  }

  async function clearAll() {
    const db = await open();
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach(s => t.objectStore(s).clear());
    return new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }

  async function exportAll() {
    const stores = {};
    for (const s of STORES) stores[s] = await getAll(s);
    return { meta: { formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString() }, stores };
  }

  const REQUIRED_FIELDS = {
    exercises: ['id', 'name'],
    sessions: ['id', 'name'],
    workouts: ['id', 'date', 'status'],
    sets: ['id', 'workoutId', 'exerciseId'],
    calendarEntries: ['id', 'date'],
    settings: ['id']
  };

  function validateImportPayload(data) {
    const errors = [];
    if (!data || typeof data !== 'object') return { valid: false, errors: ['File is not a valid backup object.'] };
    if (!data.meta || typeof data.meta.formatVersion !== 'number') {
      errors.push('Missing or invalid meta.formatVersion.');
    } else if (data.meta.formatVersion > FORMAT_VERSION) {
      errors.push('This backup was made with a newer version of FitLog than this app supports.');
    }
    const stores = data.stores;
    if (!stores || typeof stores !== 'object') {
      errors.push('Missing "stores" object.');
      return { valid: false, errors };
    }
    for (const storeName of Object.keys(REQUIRED_FIELDS)) {
      if (stores[storeName] === undefined) continue;
      if (!Array.isArray(stores[storeName])) {
        errors.push(`"${storeName}" is not an array.`);
        continue;
      }
      const required = REQUIRED_FIELDS[storeName];
      stores[storeName].forEach((record, i) => {
        for (const field of required) {
          if (record == null || record[field] === undefined) {
            errors.push(`"${storeName}"[${i}] is missing required field "${field}".`);
          }
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  // Validates fully before making any change. In 'replace' mode, existing
  // data is only cleared after validation passes — a bad file is rejected,
  // never silently destructive. The clear + every store's writes happen in
  // ONE transaction: if anything fails partway, nothing is left half-applied.
  // Imported exercise records may predate the metadata fields entirely
  // (an old formatVersion:1 backup, imported directly — the v2->v3
  // IndexedDB migration only runs on schema upgrade, never on import).
  // Normalize each one to the current shape:
  //  - already has the fields (even empty arrays) -> pass through as-is,
  //    respecting whatever the file actually says.
  //  - legacy shape + merging into an existing record that already HAS
  //    metadata -> keep the existing metadata; a legacy import must never
  //    blank out richer data already in this database.
  //  - legacy shape otherwise -> backfill by name against the seed
  //    library, or empty defaults for an unrecognized (custom) exercise.
  // IDs, names, archived state, and timestamps are untouched either way.
  function isLegacyExerciseShape(record) {
    return record.primaryMuscles === undefined;
  }

  function seedMetadataByName(name) {
    const meta = (App.exerciseSeedData || []).find(e => e.name === name);
    return meta
      ? { primaryMuscles: meta.primaryMuscles, secondaryMuscles: meta.secondaryMuscles, equipment: meta.equipment, movementType: meta.movementType }
      : { primaryMuscles: [], secondaryMuscles: [], equipment: '', movementType: '' };
  }

  async function normalizeImportedExercise(objectStore, item, mode) {
    if (!isLegacyExerciseShape(item)) return item;

    if (mode === 'merge') {
      const existing = await reqToPromise(objectStore.get(item.id));
      if (existing && !isLegacyExerciseShape(existing)) {
        return {
          ...item,
          primaryMuscles: existing.primaryMuscles,
          secondaryMuscles: existing.secondaryMuscles,
          equipment: existing.equipment,
          movementType: existing.movementType
        };
      }
    }

    return { ...item, ...seedMetadataByName(item.name) };
  }

  // Imported session records may predate the prescription fields
  // entirely — a pre-4.1 backup stores exercises as bare exerciseId
  // strings, same legacy shape the v3->v4 IndexedDB migration handles
  // (which only runs on schema upgrade, never on import). Normalize
  // every entry to the current shape:
  //  - already fully-shaped entries -> pass through App.prescriptions'
  //    (lenient) normalization, which also catches a corrupted/hand-
  //    edited value without failing the whole import.
  //  - legacy (bare-string) entries, merged into an existing session
  //    that already has real prescriptions -> keep each exercise's
  //    existing prescription for any exerciseId still present; a legacy
  //    import must never blank out prescriptions already set locally.
  //  - legacy entries otherwise -> normalize to "no prescription yet",
  //    same as any newly-added exercise.
  // Session id, name, color, and exercise order always come from the
  // imported file either way.
  function isLegacySessionExercisesShape(exercisesList) {
    return (exercisesList || []).some(e => typeof e === 'string');
  }

  async function normalizeImportedSession(objectStore, item, mode) {
    const rawExercises = item.exercises || [];
    if (!isLegacySessionExercisesShape(rawExercises)) {
      return { ...item, exercises: App.prescriptions.normalizeListLenient(rawExercises) };
    }

    if (mode === 'merge') {
      const existing = await reqToPromise(objectStore.get(item.id));
      if (existing && !isLegacySessionExercisesShape(existing.exercises || [])) {
        const existingByExerciseId = Object.fromEntries(
          App.prescriptions.normalizeListLenient(existing.exercises).map(e => [e.exerciseId, e])
        );
        return {
          ...item,
          exercises: rawExercises.map(id => existingByExerciseId[id] || App.prescriptions.normalizeEntryLenient(id))
        };
      }
    }

    return { ...item, exercises: App.prescriptions.normalizeListLenient(rawExercises) };
  }

  async function importAll(data, mode) {
    mode = mode || 'merge';
    const { valid, errors } = validateImportPayload(data);
    if (!valid) {
      const err = new Error('Import validation failed');
      err.details = errors;
      throw err;
    }

    await runTransaction(STORES, 'readwrite', async (tx) => {
      if (mode === 'replace') {
        for (const s of STORES) tx.objectStore(s).clear();
      }
      for (const s of STORES) {
        const records = data.stores[s];
        if (!Array.isArray(records)) continue;
        const os = tx.objectStore(s);
        if (s === 'exercises') {
          for (const item of records) {
            const normalized = await normalizeImportedExercise(os, item, mode);
            os.put(normalized);
          }
        } else if (s === 'sessions') {
          for (const item of records) {
            const normalized = await normalizeImportedSession(os, item, mode);
            os.put(normalized);
          }
        } else {
          for (const item of records) os.put(item);
        }
      }
    });
  }

  return {
    open, put, get, getAll, getAllByIndexRange, remove, clearAll,
    exportAll, importAll, validateImportPayload, STORES, FORMAT_VERSION,
    reqToPromise, runTransaction
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.db;
