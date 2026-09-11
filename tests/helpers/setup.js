const fakeIndexedDB = require('fake-indexeddb');
const { IDBFactory, IDBKeyRange } = fakeIndexedDB;

const SOURCE_FILES = [
  '../../js/utils.js',
  '../../js/db.js',
  '../../js/queries.js',
  '../../js/commands.js',
  '../../js/analytics.js'
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

module.exports = { freshApp };
