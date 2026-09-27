const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');
const { makeFakeSupabaseClient } = require('./helpers/fakeSupabase');

test('signed-out startup: no cloud client configured -> init() resolves to signed-out, never throws', async () => {
  const App = freshApp();
  // No _setClientForTests call at all — matches a deployment with no
  // js/cloud/config.js values and/or the SDK script not loaded.
  const user = await App.cloud.auth.init();
  assert.equal(user, null);
  assert.equal(App.cloud.auth.getUser(), null);
});

test('signed-out startup: cloud IS configured, but no persisted session -> starts signed out', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({}));
  const user = await App.cloud.auth.init();
  assert.equal(user, null);
});

test('authenticated startup: a persisted session is detected on init()', async () => {
  const App = freshApp();
  const existingUser = { id: 'user-1', email: 'sam@example.com' };
  App.cloud._setClientForTests(makeFakeSupabaseClient({ initialUser: existingUser }));
  const user = await App.cloud.auth.init();
  assert.deepEqual(user, existingUser);
  assert.deepEqual(App.cloud.auth.getUser(), existingUser);
});

test('sign up creates an account and signs in when no email confirmation is required', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({}));
  await App.cloud.auth.init();

  const result = await App.cloud.auth.signUp('new@example.com', 'hunter22');
  assert.equal(result.confirmationRequired, false);
  assert.equal(App.cloud.auth.getUser().email, 'new@example.com');
});

test('sign up reports confirmationRequired and stays signed out when the project requires email confirmation', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({ requireEmailConfirmation: true }));
  await App.cloud.auth.init();

  const result = await App.cloud.auth.signUp('new@example.com', 'hunter22');
  assert.equal(result.confirmationRequired, true);
  assert.equal(App.cloud.auth.getUser(), null, 'no session yet, so still signed out');
});

test('sign in with correct credentials succeeds', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.init();

  const user = await App.cloud.auth.signIn('sam@example.com', 'correct-horse');
  assert.equal(user.email, 'sam@example.com');
  assert.equal(App.cloud.auth.getUser().email, 'sam@example.com');
});

test('sign in with wrong password is rejected and leaves the user signed out', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.init();

  await assert.rejects(() => App.cloud.auth.signIn('sam@example.com', 'wrong-password'));
  assert.equal(App.cloud.auth.getUser(), null);
});

test('sign out clears the current user', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.init();
  await App.cloud.auth.signIn('sam@example.com', 'correct-horse');
  assert.ok(App.cloud.auth.getUser());

  await App.cloud.auth.signOut();
  assert.equal(App.cloud.auth.getUser(), null);
});

test('onChange listeners are notified on sign in and sign out', async () => {
  const App = freshApp();
  App.cloud._setClientForTests(makeFakeSupabaseClient({
    knownUsers: [{ id: 'user-1', email: 'sam@example.com', password: 'correct-horse' }]
  }));
  await App.cloud.auth.init();

  const seen = [];
  const unsubscribe = App.cloud.auth.onChange((user) => seen.push(user ? user.email : null));

  await App.cloud.auth.signIn('sam@example.com', 'correct-horse');
  await App.cloud.auth.signOut();

  assert.deepEqual(seen, ['sam@example.com', null]);
  unsubscribe();
});

test('signing up/in without a configured client throws CloudUnavailableError, never silently succeeds', async () => {
  const App = freshApp();
  await App.cloud.auth.init();
  await assert.rejects(() => App.cloud.auth.signIn('a@b.com', 'x'), App.errors.CloudUnavailableError);
  await assert.rejects(() => App.cloud.auth.signUp('a@b.com', 'x'), App.errors.CloudUnavailableError);
});
