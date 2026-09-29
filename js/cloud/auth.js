window.App = window.App || {};
App.cloud = App.cloud || {};

// Thin wrapper around Supabase Auth. Nothing outside App.cloud.* ever
// touches a Supabase client directly for auth — App.views.account (and any
// future caller) only ever sees getUser()/signUp()/signIn()/signOut()/
// onChange(), so the actual Supabase calls stay swappable and testable
// behind App.cloud.getClient().
//
// FitLog remains fully usable signed out: nothing in commands.js or
// queries.js consults this module, and init() below never throws — a
// missing/unreachable Supabase client just means getUser() stays null.
App.cloud.auth = (function () {
  let currentUser = null;
  let initialized = false;
  let listeners = [];

  function notify() {
    listeners.slice().forEach((fn) => {
      try { fn(currentUser); } catch (e) { /* a listener's own error must never break auth state */ }
    });
  }

  // The one place currentUser is ever assigned. A real (and this app's
  // fake test) Supabase client fires onAuthStateChange for the SAME
  // transition a direct signIn()/signUp()/signOut() call already
  // causes, so every write goes through here and listeners are only
  // notified when the signed-in identity actually changes — never
  // twice for one transition.
  function setCurrentUser(user) {
    const prevId = currentUser ? currentUser.id : null;
    const nextId = user ? user.id : null;
    currentUser = user;
    if (prevId !== nextId) notify();
  }

  // Subscribe to sign-in/sign-out changes (e.g. the Account screen re-
  // renders itself). Returns an unsubscribe function.
  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(f => f !== fn); };
  }

  function getUser() {
    return currentUser;
  }

  // Detects an existing (persisted) session on startup. Safe to call
  // whether or not cloud is configured — with no client available this
  // simply resolves to "signed out" rather than throwing, so app boot
  // never fails because of it.
  async function init() {
    const client = App.cloud.getClient();
    if (!client) {
      currentUser = null;
      initialized = true;
      return null;
    }
    const { data } = await client.auth.getSession();
    currentUser = (data && data.session) ? data.session.user : null;
    client.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session ? session.user : null);
    });
    initialized = true;
    return currentUser;
  }

  function requireClient() {
    const client = App.cloud.getClient();
    if (!client) throw new App.errors.CloudUnavailableError('Cloud sign-in is not set up for this deployment.');
    return client;
  }

  async function signUp(email, password) {
    const client = requireClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // A project with "confirm email" enabled returns a user but no
    // session yet — reflect that as "still signed out" rather than
    // guessing the user is authenticated.
    setCurrentUser((data && data.session) ? data.session.user : null);
    return { user: (data && data.user) || null, confirmationRequired: !(data && data.session) };
  }

  async function signIn(email, password) {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setCurrentUser(data.user);
    return currentUser;
  }

  async function signOut() {
    const client = App.cloud.getClient();
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    setCurrentUser(null);
  }

  return { init, getUser, signUp, signIn, signOut, onChange, isInitialized: () => initialized };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.cloud.auth;
