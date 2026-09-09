window.App = window.App || {};

App.db = (function () {
  const DB_NAME = 'fitlog';
  const DB_VERSION = 2;
  const FORMAT_VERSION = 2;
  const STORES = ['settings', 'exercises', 'workouts', 'workoutExercises', 'sets', 'templates',
    'bodyweightLogs', 'nutritionLogs', 'sleepLogs', 'measurements', 'notes'];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        const oldVersion = e.oldVersion;

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('exercises')) {
          const s = db.createObjectStore('exercises', { keyPath: 'id' });
          s.createIndex('name', 'name');
          s.createIndex('archived', 'archived');
        }

        let workoutsStore;
        if (!db.objectStoreNames.contains('workouts')) {
          workoutsStore = db.createObjectStore('workouts', { keyPath: 'id' });
          workoutsStore.createIndex('date', 'date');
        } else {
          workoutsStore = tx.objectStore('workouts');
        }
        if (!workoutsStore.indexNames.contains('status')) {
          workoutsStore.createIndex('status', 'status');
        }

        if (!db.objectStoreNames.contains('workoutExercises')) {
          const s = db.createObjectStore('workoutExercises', { keyPath: 'id' });
          s.createIndex('workoutId', 'workoutId');
        }

        let setsStore;
        if (!db.objectStoreNames.contains('sets')) {
          setsStore = db.createObjectStore('sets', { keyPath: 'id' });
          setsStore.createIndex('workoutId', 'workoutId');
          setsStore.createIndex('exerciseId', 'exerciseId');
        } else {
          setsStore = tx.objectStore('sets');
        }
        if (!setsStore.indexNames.contains('workoutExerciseId')) {
          setsStore.createIndex('workoutExerciseId', 'workoutExerciseId');
        }

        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('bodyweightLogs')) {
          const s = db.createObjectStore('bodyweightLogs', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('nutritionLogs')) {
          // keyPath id === the date string itself: one record per day.
          db.createObjectStore('nutritionLogs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sleepLogs')) {
          const s = db.createObjectStore('sleepLogs', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('measurements')) {
          const s = db.createObjectStore('measurements', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('notes')) {
          const s = db.createObjectStore('notes', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }

        if (oldVersion > 0 && oldVersion < 2) {
          migrateV1ToV2(tx);
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  // v1 workouts stored a bare exerciseOrder array; sets referenced exerciseId
  // directly with no workoutExercise join row. This backfills both: creates
  // a workoutExercise per entry in exerciseOrder, sets workout.status from
  // endedAt, and patches existing sets with the new workoutExerciseId.
  function migrateV1ToV2(tx) {
    const workoutsStore = tx.objectStore('workouts');
    const workoutExercisesStore = tx.objectStore('workoutExercises');
    const setsStore = tx.objectStore('sets');
    const setsByWorkoutIndex = setsStore.index('workoutId');

    workoutsStore.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const workout = cursor.value;
      let changed = false;

      if (!workout.status) {
        workout.status = workout.endedAt ? 'completed' : 'in_progress';
        changed = true;
      }

      const order = Array.isArray(workout.exerciseOrder) ? workout.exerciseOrder : [];
      const weIdByExerciseId = {};
      order.forEach((exerciseId, i) => {
        const weId = App.utils.uuid();
        weIdByExerciseId[exerciseId] = weId;
        workoutExercisesStore.add({
          id: weId,
          workoutId: workout.id,
          exerciseId,
          order: i,
          note: '',
          createdAt: workout.createdAt || workout.startedAt || App.utils.nowISO()
        });
      });

      if (changed) cursor.update(workout);

      if (order.length) {
        setsByWorkoutIndex.openCursor(IDBKeyRange.only(workout.id)).onsuccess = (ev) => {
          const setCursor = ev.target.result;
          if (!setCursor) return;
          const set = setCursor.value;
          if (!set.workoutExerciseId && weIdByExerciseId[set.exerciseId]) {
            set.workoutExerciseId = weIdByExerciseId[set.exerciseId];
            setCursor.update(set);
          }
          setCursor.continue();
        };
      }

      cursor.continue();
    };
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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

  // Indexed lookup — use this instead of getAll()+filter() whenever a query
  // is scoped to one exercise/workout/date range. Range may be omitted.
  async function getAllByIndexRange(store, indexName, range) {
    const db = await open();
    const t = db.transaction([store], 'readonly');
    return reqToPromise(t.objectStore(store).index(indexName).getAll(range));
  }

  // Range query directly on the primary key (used for nutritionLogs, whose
  // keyPath IS the date, so no secondary index is needed).
  async function getByKeyRange(store, range) {
    const db = await open();
    const t = db.transaction([store], 'readonly');
    return reqToPromise(t.objectStore(store).getAll(range));
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
    for (const s of STORES) {
      stores[s] = await getAll(s);
    }
    return {
      meta: { formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString() },
      stores
    };
  }

  // Required fields checked per store — enough to catch a corrupted or
  // hand-edited file without maintaining a full schema validator.
  const REQUIRED_FIELDS = {
    exercises: ['id', 'name'],
    workouts: ['id', 'date', 'status'],
    workoutExercises: ['id', 'workoutId', 'exerciseId'],
    sets: ['id', 'workoutId', 'exerciseId'],
    templates: ['id', 'name'],
    bodyweightLogs: ['id', 'date', 'weight'],
    nutritionLogs: ['id', 'date'],
    sleepLogs: ['id', 'date'],
    measurements: ['id', 'date', 'type'],
    notes: ['id', 'date']
  };

  function validateImportPayload(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['File is not a valid backup object.'] };
    }
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
      if (stores[storeName] === undefined) continue; // optional store, fine
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

  // Validates fully before making any change. In 'replace' mode, the
  // existing database is only cleared after validation passes, so a bad
  // file is rejected instead of silently destroying real data.
  async function importAll(data, mode) {
    mode = mode || 'merge';
    const { valid, errors } = validateImportPayload(data);
    if (!valid) {
      const err = new Error('Import validation failed');
      err.details = errors;
      throw err;
    }

    if (mode === 'replace') {
      await clearAll();
    }

    const db = await open();
    for (const s of STORES) {
      const records = data.stores[s];
      if (!Array.isArray(records)) continue;
      const t = db.transaction([s], 'readwrite');
      const os = t.objectStore(s);
      records.forEach(item => os.put(item));
      await new Promise((resolve, reject) => {
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    }
  }

  return {
    open, put, get, getAll, getAllByIndexRange, getByKeyRange, remove, clearAll,
    exportAll, importAll, validateImportPayload, STORES, FORMAT_VERSION
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.db;
