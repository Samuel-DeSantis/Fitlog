const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

function goToAccount(document) {
  document.location.hash = '/account';
}

test('Account screen: cloud not configured shows a plain explanatory note, no sign-in form', async () => {
  const { document } = await bootRealApp();
  goToAccount(document);
  await wait(30);

  assert.match(document.body.textContent, /Cloud features unavailable/);
  assert.match(document.body.textContent, /local-only mode/);
  assert.doesNotMatch(document.body.textContent, /sync/i, 'no misleading sync language');
  assert.equal(document.getElementById('auth-email'), null);
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('Account screen: configured + signed out shows the sign-in/sign-up form, no Cloud section yet', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToAccount(document);
  await wait(30);

  assert.match(document.body.textContent, /using FitLog locally/);
  assert.ok(document.getElementById('auth-show-create-btn'));
  assert.ok(document.getElementById('auth-show-signin-btn'));
  assert.ok(document.getElementById('export-btn') && document.getElementById('import-btn'), 'import/export stay reachable signed out');
  assert.equal(document.getElementById('cloud-backup-btn'), null, 'Cloud section only appears once signed in');
});

test('Account screen: signing in through the UI reveals the Cloud section and the signed-in email', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToAccount(document);
  await wait(30);
  click(document.getElementById('auth-show-signin-btn'));
  await wait(30);
  setValue(document.getElementById('auth-email'), 'sam@example.com');
  setValue(document.getElementById('auth-password'), 'correct-horse');
  click(document.getElementById('auth-submit-btn'));
  await wait(30);

  assert.match(document.body.textContent, /sam@example\.com/);
  assert.match(document.body.textContent, /Connected/);
  assert.ok(document.getElementById('cloud-backup-btn'));
  assert.ok(document.getElementById('cloud-restore-btn'));
});

test('Account screen: signing in with the wrong password shows an error and stays on the form', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToAccount(document);
  await wait(30);
  click(document.getElementById('auth-show-signin-btn'));
  await wait(30);
  setValue(document.getElementById('auth-email'), 'sam@example.com');
  setValue(document.getElementById('auth-password'), 'wrong-password');
  click(document.getElementById('auth-submit-btn'));
  await wait(30);

  assert.ok(document.getElementById('auth-email'), 'still on the sign-in form');
  assert.match(document.getElementById('auth-status').textContent, /Invalid login credentials/);
});

test('Account screen: creating an account that requires email confirmation shows a confirmation message, not a signed-in state', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({ requireEmailConfirmation: true }));

  goToAccount(document);
  await wait(30);
  click(document.getElementById('auth-show-create-btn'));
  await wait(30);
  setValue(document.getElementById('auth-email'), 'new@example.com');
  setValue(document.getElementById('auth-password'), 'hunter22');
  click(document.getElementById('auth-submit-btn'));
  await wait(30);

  assert.match(document.getElementById('auth-status').textContent, /Check your email/);
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('Account screen: signing out returns to the signed-out form', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.signIn('sam@example.com', 'correct-horse');

  goToAccount(document);
  await wait(30);
  assert.ok(document.getElementById('auth-signout-btn'));

  click(document.getElementById('auth-signout-btn'));
  await wait(30);

  assert.ok(document.getElementById('auth-show-signin-btn'), 'back to the signed-out screen');
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('Account screen: Back Up Data button backs up local data and reports a summary', async () => {
  const { document, App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ initialUser: { id: 'user-1', email: 'sam@example.com' } });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();

  goToAccount(document);
  await wait(30);
  click(document.getElementById('cloud-backup-btn'));
  await wait(30);

  assert.match(document.getElementById('cloud-status').textContent, /Backup complete/);
  assert.ok(client._tables.exercises.size > 0, 'the seeded exercise library was actually uploaded');
});

test('Account screen: Restore from Cloud asks for confirmation before running', async () => {
  const { document, App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ initialUser: { id: 'user-1', email: 'sam@example.com' } });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();

  // App code (loaded via require(), same as the rest of the test
  // harness — see domSetup.js) resolves the bare `confirm` identifier
  // from the Node global, same place domSetup.js's own stub lives.
  let confirmCalls = 0;
  global.confirm = () => { confirmCalls++; return true; };

  goToAccount(document);
  await wait(30);
  click(document.getElementById('cloud-restore-btn'));
  await wait(30);

  assert.equal(confirmCalls, 1, 'restore must always ask for confirmation first');
});

test('Account screen: create-account rejects a short password before calling the server', async () => {
  const { document, App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ requireEmailConfirmation: true });
  App.cloud._setClientForTests(client);

  goToAccount(document);
  await wait(30);
  click(document.getElementById('auth-show-create-btn'));
  await wait(30);
  setValue(document.getElementById('auth-email'), 'new@example.com');
  setValue(document.getElementById('auth-password'), 'short');
  click(document.getElementById('auth-submit-btn'));
  await wait(30);

  assert.match(document.getElementById('auth-status').textContent, /at least 8 characters/);
});

test('Navigation: Account is the fifth tab, More is gone, /more no longer routes', async () => {
  const { document } = await bootRealApp();
  const tabs = [...document.querySelectorAll('.nav-tab')].map(t => t.dataset.route);
  assert.deepEqual(tabs, ['/today', '/train', '/calendar', '/progress', '/account']);
  assert.equal(document.querySelector('.nav-tab[data-route="/more"]'), null);

  goToAccount(document);
  await wait(30);
  assert.ok(document.querySelector('.nav-tab[data-route="/account"]').classList.contains('active'));
  assert.equal(document.querySelector('#app-content h1').textContent, 'Account');

  document.location.hash = '/more';
  await wait(30);
  assert.notEqual(document.querySelector('#app-content h1').textContent, 'More');
});
