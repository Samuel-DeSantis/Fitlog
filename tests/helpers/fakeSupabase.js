// A tiny in-memory stand-in for the real Supabase JS client, used only
// by unit tests (see App.cloud._setClientForTests in
// js/cloud/supabaseClient.js). It implements exactly the subset of the
// real client's surface App.cloud.auth/backup/restore call:
//
//   client.auth.getSession()
//   client.auth.onAuthStateChange(cb)
//   client.auth.signUp({ email, password })
//   client.auth.signInWithPassword({ email, password })
//   client.auth.signOut()
//   client.from(table).upsert(rowOrRows, { onConflict })
//   client.from(table).select('*').eq(col, val)
//
// It is deliberately NOT a general Postgrest mock — just enough to
// exercise FitLog's own cloud modules deterministically, with no
// network and no real Supabase project.
function makeFakeSupabaseClient(opts) {
  opts = opts || {};
  // tableName -> Map(id-or-user_id -> row). Exposed as `tables` so tests
  // can pre-seed cloud state (e.g. simulate "another device already
  // backed this up") or assert on what ended up there. Pre-created for
  // every known FitLog cloud table (rather than lazily on first
  // `from()` call) so a test can seed `_tables.exercises` etc. before
  // any backup/restore call ever touches that table.
  const KNOWN_TABLES = ['exercises', 'sessions', 'workouts', 'sets', 'calendar_entries', 'user_settings'];
  const tables = {};
  KNOWN_TABLES.forEach((name) => { tables[name] = new Map(); });
  function tableFor(name) {
    if (!tables[name]) tables[name] = new Map();
    return tables[name];
  }

  let session = opts.initialUser ? { user: opts.initialUser } : null;
  const knownUsers = new Map(); // email -> { id, email, password }
  (opts.knownUsers || []).forEach(u => knownUsers.set(u.email, u));
  const authListeners = [];

  function notifyAuth() {
    authListeners.forEach(cb => cb('SIGNED_IN_OR_OUT', session));
  }

  const auth = {
    async getSession() {
      return { data: { session }, error: null };
    },
    onAuthStateChange(cb) {
      authListeners.push(cb);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signUp({ email, password }) {
      if (knownUsers.has(email)) {
        return { data: {}, error: { message: 'User already registered' } };
      }
      const user = { id: 'user-' + email, email };
      knownUsers.set(email, { ...user, password });
      if (opts.requireEmailConfirmation) {
        // No session yet — mirrors a real project with email
        // confirmation enabled.
        return { data: { user, session: null }, error: null };
      }
      session = { user };
      notifyAuth();
      return { data: { user, session }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const known = knownUsers.get(email);
      if (!known || known.password !== password) {
        return { data: {}, error: { message: 'Invalid login credentials' } };
      }
      const user = { id: known.id, email: known.email };
      session = { user };
      notifyAuth();
      return { data: { user }, error: null };
    },
    async signOut() {
      session = null;
      notifyAuth();
      return { error: null };
    }
  };

  function from(tableName) {
    const table = tableFor(tableName);
    return {
      async upsert(rowOrRows, upsertOpts) {
        const conflictKey = (upsertOpts && upsertOpts.onConflict) || 'id';
        const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        rows.forEach((row) => { table.set(row[conflictKey], { ...row }); });
        return { data: rows, error: null };
      },
      select() {
        return {
          async eq(col, val) {
            const matches = [...table.values()].filter(r => r[col] === val);
            return { data: matches, error: null };
          }
        };
      }
    };
  }

  return { auth, from, _tables: tables, _knownUsers: knownUsers };
}

module.exports = { makeFakeSupabaseClient };
