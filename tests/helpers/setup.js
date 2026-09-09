const fakeIndexedDB = require('fake-indexeddb');
const { IDBFactory, IDBKeyRange } = fakeIndexedDB;

const SOURCE_FILES = [
  '../../js/utils.js',
  '../../js/db.js',
  '../../js/queries.js',
  '../../js/commands.js',
  '../../js/analytics.js'
];

// Loads the app's real source files (unmodified) into a clean global
// environment with a brand-new in-memory IndexedDB, so each test gets an
// isolated database and the exact same code that ships to the browser.
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

module.exports = { freshApp };
