window.App = window.App || {};

App.db = (function () {
  const DB_NAME = 'fitlog';
  const DB_VERSION = 1;
  const STORES = ['settings', 'exercises', 'workouts', 'sets', 'templates',
    'bodyweightLogs', 'nutritionLogs', 'sleepLogs', 'measurements', 'notes'];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('exercises')) {
          const s = db.createObjectStore('exercises', { keyPath: 'id' });
          s.createIndex('name', 'name');
          s.createIndex('archived', 'archived');
        }
        if (!db.objectStoreNames.contains('workouts')) {
          const s = db.createObjectStore('workouts', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('sets')) {
          const s = db.createObjectStore('sets', { keyPath: 'id' });
          s.createIndex('workoutId', 'workoutId');
          s.createIndex('exerciseId', 'exerciseId');
        }
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('bodyweightLogs')) {
          const s = db.createObjectStore('bodyweightLogs', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('nutritionLogs')) {
          const s = db.createObjectStore('nutritionLogs', { keyPath: 'id' });
          s.createIndex('date', 'date');
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
    const result = await reqToPromise(t.objectStore(store).put(value));
    return result;
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
    const data = {};
    for (const s of STORES) {
      data[s] = await getAll(s);
    }
    data._meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
    return data;
  }

  async function importAll(data, mode) {
    mode = mode || 'merge';
    if (mode === 'replace') {
      await clearAll();
    }
    const db = await open();
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      const t = db.transaction([s], 'readwrite');
      const os = t.objectStore(s);
      data[s].forEach(item => os.put(item));
      await new Promise((resolve, reject) => {
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
      });
    }
  }

  return { open, put, get, getAll, remove, clearAll, exportAll, importAll, STORES };
})();
