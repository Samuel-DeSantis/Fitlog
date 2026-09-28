// FitLog cloud configuration (Phase 6).
//
// Fill in your own Supabase project's URL and public "anon" key below.
// Find both on your Supabase dashboard under Project Settings -> API.
//
//   url:     e.g. 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co'
//   anonKey: the "anon" / "public" key — NOT the service_role key.
//
// It is safe to ship the anon key in frontend code: every table it can
// reach is gated by Postgres Row Level Security (see
// supabase/schema.sql), so on its own it only ever grants "a signed-in
// user may read/write their own rows" — nothing else.
//
// NEVER put a service-role/secret key here or anywhere else in this
// app. A service-role key bypasses Row Level Security entirely and
// must only ever be used from a trusted backend, which FitLog does not
// have (and Phase 6 does not add one).
//
// Leaving both fields blank is a fully supported configuration: FitLog
// runs entirely locally in that case, and the More screen's Account/
// Cloud sections explain that cloud sync isn't set up for this
// deployment rather than showing broken sign-in fields.
window.FITLOG_SUPABASE_CONFIG = {
  url: 'https://iibfunhnvddhtpkfptqe.supabase.co',
  anonKey: 'sb_publishable_8S1iiIkGz-vefZn5EAKVFA_f4sMJfNf'
};
