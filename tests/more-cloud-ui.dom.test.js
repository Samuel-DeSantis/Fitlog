const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

function goToMore(document) {
  document.location.hash = '/more';
}

test('More screen: cloud not configured shows a plain explanatory note, no sign-in form', async () => {
  const { document } = await bootRealApp();
  goToMore(document);
  await wait(30);

  assert.match(document.body.textContent, /Cloud sync isn't set up/);
  assert.equal(document.getElementById('auth-email'), null);
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('More screen: configured + signed out shows the sign-in/sign-up form, no Cloud section yet', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToMore(document);
  await wait(30);

  assert.ok(document.getElementById('auth-email'));
  assert.ok(document.getElementById('auth-signin-btn'));
  assert.ok(document.getElementById('auth-signup-btn'));
  assert.equal(document.getElementById('cloud-backup-btn'), null, 'Cloud section only appears once signed in');
});

test('More screen: signing in through the UI reveals the Cloud section and the signed-in email', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToMore(document);
  await wait(30);
  setValue(document.getElementById('auth-email'), 'sam@example.com');
  setValue(document.getElementById('auth-password'), 'correct-horse');
  click(document.getElementById('auth-signin-btn'));
  await wait(30);

  assert.match(document.body.textContent, /Signed in as sam@example\.com/);
  assert.ok(document.getElementById('cloud-backup-btn'));
  assert.ok(document.getElementById('cloud-restore-btn'));
});

test('More screen: signing in with the wrong password shows an error and stays on the form', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));

  goToMore(document);
  await wait(30);
  setValue(document.getElementById('auth-email'), 'sam@example.com');
  setValue(document.getElementById('auth-password'), 'wrong-password');
  click(document.getElementById('auth-signin-btn'));
  await wait(30);

  assert.ok(document.getElementById('auth-email'), 'still on the sign-in form');
  assert.match(document.getElementById('auth-status').textContent, /Invalid login credentials/);
});

test('More screen: creating an account that requires email confirmation shows a confirmation message, not a signed-in state', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({ requireEmailConfirmation: true }));

  goToMore(document);
  await wait(30);
  setValue(document.getElementById('auth-email'), 'new@example.com');
  setValue(document.getElementById('auth-password'), 'hunter22');
  click(document.getElementById('auth-signup-btn'));
  await wait(30);

  assert.match(document.getElementById('auth-status').textContent, /Check your email/);
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('More screen: signing out returns to the signed-out form', async () => {
  const { document, App } = await bootRealApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.signIn('sam@example.com', 'correct-horse');

  goToMore(document);
  await wait(30);
  assert.ok(document.getElementById('auth-signout-btn'));

  click(document.getElementById('auth-signout-btn'));
  await wait(30);

  assert.ok(document.getElementById('auth-email'), 'back to the sign-in form');
  assert.equal(document.getElementById('cloud-backup-btn'), null);
});

test('More screen: Back Up Data button backs up local data and reports a summary', async () => {
  const { document, App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ initialUser: { id: 'user-1', email: 'sam@example.com' } });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();

  goToMore(document);
  await wait(30);
  click(document.getElementById('cloud-backup-btn'));
  await wait(30);

  assert.match(document.getElementById('cloud-status').textContent, /Backup complete/);
  assert.ok(client._tables.exercises.size > 0, 'the seeded exercise library was actually uploaded');
});

test('More screen: Restore from Cloud asks for confirmation before running', async () => {
  const { document, App } = await bootRealApp();
  const client = makeFakeSupabaseClient({ initialUser: { id: 'user-1', email: 'sam@example.com' } });
  App.cloud._setClientForTests(client);
  await App.cloud.auth.init();

  // App code (loaded via require(), same as the rest of the test
  // harness — see domSetup.js) resolves the bare `confirm` identifier
  // from the Node global, same place domSetup.js's own stub lives.
  let confirmCalls = 0;
  global.confirm = () => { confirmCalls++; return true; };

  goToMore(document);
  await wait(30);
  click(document.getElementById('cloud-restore-btn'));
  await wait(30);

  assert.equal(confirmCalls, 1, 'restore must always ask for confirmation first');
});
