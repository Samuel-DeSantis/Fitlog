const fakeIndexedDB = require('fake-indexeddb');
const { IDBFactory, IDBKeyRange } = fakeIndexedDB;

const SOURCE_FILES = [
  '../../js/utils.js',
  '../../js/errors.js',
  '../../js/sessionColors.js',
  '../../js/prescriptions.js',
  '../../js/exerciseMetadata.js',
  '../../js/muscleGroups.js',
  '../../js/db.js',
  '../../js/queries.js',
  '../../js/commands.js',
  '../../js/analytics.js',
  '../../js/seed.js'
];

function freshApp() {
  global.window = global;
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  global.App = {};
  global.window.App = global.App;

  for (const rel of SOURCE_FILES) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }
  return global.App;
}

// Simulates closing and reopening the app: the SAME underlying IndexedDB
// data survives (it's disk-backed in a real browser), but every JS module
// is torn down and re-loaded fresh, exactly like a real page reload. This
// is different from freshApp(), which also wipes the data.
function reopenApp() {
  const existingIndexedDB = global.indexedDB;
  global.window = global;
  global.indexedDB = existingIndexedDB;
  global.IDBKeyRange = IDBKeyRange;
  global.App = {};
  global.window.App = global.App;

  for (const rel of SOURCE_FILES) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }
  return global.App;
}

module.exports = { freshApp, reopenApp };
