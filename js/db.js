window.App = window.App || {};

App.db = (function () {
  const DB_NAME = 'fitlog_v2';
  const DB_VERSION = 1;
  const FORMAT_VERSION = 1;
  const STORES = ['exercises', 'sessions', 'workouts', 'sets', 'calendarEntries', 'settings'];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

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
        // Future schema changes: branch on e.oldVersion here, same pattern
        // as this project's previous v1->v2 migration. No migration needed
        // yet — this is version 1 of a fresh schema.
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
  // never silently destructive.
  async function importAll(data, mode) {
    mode = mode || 'merge';
    const { valid, errors } = validateImportPayload(data);
    if (!valid) {
      const err = new Error('Import validation failed');
      err.details = errors;
      throw err;
    }
    if (mode === 'replace') await clearAll();

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
    open, put, get, getAll, getAllByIndexRange, remove, clearAll,
    exportAll, importAll, validateImportPayload, STORES, FORMAT_VERSION
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.db;
