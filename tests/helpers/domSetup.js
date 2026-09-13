const { JSDOM } = require('jsdom');
const fakeIndexedDB = require('fake-indexeddb');
const { IDBFactory, IDBKeyRange } = fakeIndexedDB;

const SHELL_HTML = `
<!DOCTYPE html>
<html><body>
  <main id="app-content" class="app-content"></main>
  <nav class="nav-bar">
    <button class="nav-tab" data-route="/today"><span>Today</span></button>
    <button class="nav-tab" data-route="/train"><span>Train</span></button>
    <button class="nav-tab" data-route="/calendar"><span>Calendar</span></button>
    <button class="nav-tab" data-route="/progress"><span>Progress</span></button>
    <button class="nav-tab" data-route="/more"><span>More</span></button>
  </nav>
</body></html>
`;

const SOURCE_FILES = [
  '../../js/utils.js',
  '../../js/errors.js',
  '../../js/sessionColors.js',
  '../../js/db.js',
  '../../js/queries.js',
  '../../js/commands.js',
  '../../js/analytics.js',
  '../../js/seed.js',
  '../../js/router.js',
  '../../js/ui.js',
  '../../js/views/today.js',
  '../../js/views/train.js',
  '../../js/views/workout.js',
  '../../js/views/calendar.js',
  '../../js/views/progress.js',
  '../../js/views/more.js',
  '../../js/app.js'
];

// Boots the real application into a real (jsdom) DOM, backed by a fresh
// in-memory IndexedDB, and returns handles for driving it like a user
// would: navigating, clicking, typing. This is the closest this
// environment can get to "open the app and click around" without an
// actual browser.
async function bootRealApp() {
  return bootInternal(new IDBFactory());
}

// Simulates closing and reopening the app: same underlying IndexedDB data,
// entirely fresh DOM/JS, exactly like a real page reload.
async function reopenRealApp() {
  return bootInternal(global.indexedDB);
}

async function bootInternal(indexedDBInstance) {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;
  global.location = window.location;
  global.HTMLElement = window.HTMLElement;
  global.indexedDB = indexedDBInstance;
  global.IDBKeyRange = IDBKeyRange;

  // jsdom deliberately throws on window.alert/confirm/prompt ("not
  // implemented"). Stub them like a user always clicking through.
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => 'Test Exercise';
  global.alert = window.alert;
  global.confirm = window.confirm;
  global.prompt = window.prompt;

  if (!window.crypto) window.crypto = {};
  if (!window.crypto.randomUUID) window.crypto.randomUUID = () => require('crypto').randomUUID();

  global.App = {};
  window.App = global.App;

  for (const rel of SOURCE_FILES) {
    delete require.cache[require.resolve(rel)];
    require(rel);
  }

  await global.App._bootPromise;
  return { window, document: window.document, App: global.App };
}

function click(el) {
  el.dispatchEvent(new global.window.Event('click', { bubbles: true }));
}

function setValue(inputEl, value) {
  inputEl.value = value;
  inputEl.dispatchEvent(new global.window.Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new global.window.Event('change', { bubbles: true }));
}

// Flushes pending debounced saves / microtasks. Set-row inputs debounce
// their save by 300ms, so tests that type into a set and immediately
// assert persisted state need to wait this out.
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { bootRealApp, reopenRealApp, click, setValue, wait };
