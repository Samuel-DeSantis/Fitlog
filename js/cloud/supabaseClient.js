window.App = window.App || {};

// Phase 6: the ONLY place that knows how to obtain a Supabase client.
// Everything else in App.cloud.* (auth, backup, restore) calls
// App.cloud.getClient() and treats a null return as "cloud isn't
// available right now" — never reaching for `window.supabase` or
// `window.FITLOG_SUPABASE_CONFIG` directly. That keeps FitLog's
// local-first guarantee mechanical rather than something every caller
// has to remember: local commands/queries never import this file at
// all, and everything that does is written to degrade to "cloud
// unavailable" instead of throwing when it's missing.
//
// Configuration: index.html loads (in order)
//   1. the Supabase UMD SDK from a CDN (defines window.supabase)
//   2. js/cloud/config.js, which sets window.FITLOG_SUPABASE_CONFIG =
//      { url, anonKey } — see that file for setup instructions.
// Both are optional. Running without either is a fully supported
// configuration: FitLog works entirely locally, and the More screen's
// Account/Cloud sections explain that cloud sync isn't set up rather
// than showing broken sign-in fields.
//
// IMPORTANT: url/anonKey are the public Supabase "anon" key, which is
// SAFE to ship in frontend code by design — every table it can reach
// is still gated by Postgres Row Level Security (see
// supabase/schema.sql). Never put a service-role key anywhere in this
// app.
App.cloud = (function () {
  let cachedClient = null;
  let cachedConfigKey = null; // detects a config change between calls
  let testClientOverride = null;

  function getConfig() {
    return (typeof window !== 'undefined' && window.FITLOG_SUPABASE_CONFIG) || {};
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.url && c.anonKey);
  }

  function sdkAvailable() {
    return typeof window !== 'undefined' && typeof window.supabase !== 'undefined'
      && typeof window.supabase.createClient === 'function';
  }

  // Returns a Supabase client, or null if cloud isn't usable right now
  // (not configured, SDK script didn't load, or — in tests — no fake
  // client has been injected). Never throws: a null return is the
  // normal, expected "operate locally only" signal.
  function getClient() {
    if (testClientOverride) return testClientOverride;
    if (!isConfigured() || !sdkAvailable()) return null;

    const config = getConfig();
    const configKey = config.url + '|' + config.anonKey;
    if (cachedClient && cachedConfigKey === configKey) return cachedClient;

    cachedClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    cachedConfigKey = configKey;
    return cachedClient;
  }

  // ---- test-only seam ----
  // Unit tests never talk to a real Supabase project. Instead they build
  // a small in-memory fake exposing the same minimal `auth` /
  // `from(table)` surface App.cloud.auth/backup/restore actually call,
  // and inject it here. Real (browser) code never calls this.
  function _setClientForTests(fakeClient) {
    testClientOverride = fakeClient;
  }

  function _resetForTests() {
    testClientOverride = null;
    cachedClient = null;
    cachedConfigKey = null;
  }

  return { getConfig, isConfigured, sdkAvailable, getClient, _setClientForTests, _resetForTests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.cloud;
