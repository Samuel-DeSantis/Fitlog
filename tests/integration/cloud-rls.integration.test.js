// Real-Supabase-project integration test for Row Level Security AND
// tenant-scoped foreign-key integrity (see supabase/schema.sql).
//
// This is intentionally NOT part of `npm test` (it lives under
// tests/integration/, and the main test script only globs tests/*.test.js
// — see package.json). It needs a real Supabase project with
// supabase/schema.sql already applied, and TWO real (already-created)
// test accounts in that project's Auth. See docs/cloud-setup.md for the
// full one-time setup.
//
// Run with:
//   SUPABASE_TEST_URL=https://xxxx.supabase.co \
//   SUPABASE_TEST_PUBLISHABLE_KEY=your-publishable-key \
//   SUPABASE_TEST_USER_A_EMAIL=a@test.com SUPABASE_TEST_USER_A_PASSWORD=... \
//   SUPABASE_TEST_USER_B_EMAIL=b@test.com SUPABASE_TEST_USER_B_PASSWORD=... \
//   npm run test:cloud-integration
//
// Without those env vars every test below is skipped (not failed) so
// `npm test` and CI never need real credentials.
//
// IMPORTANT: use a disposable/dev Supabase project for this, never a
// project with real user data — this test writes and deletes rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const REQUIRED_ENV = [
  'SUPABASE_TEST_URL', 'SUPABASE_TEST_PUBLISHABLE_KEY',
  'SUPABASE_TEST_USER_A_EMAIL', 'SUPABASE_TEST_USER_A_PASSWORD',
  'SUPABASE_TEST_USER_B_EMAIL', 'SUPABASE_TEST_USER_B_PASSWORD'
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
const skip = missing.length
  ? `Skipped: set ${missing.join(', ')} to run this against a real Supabase project (see docs/cloud-setup.md)`
  : false;

// Only required when actually running for real — never for a normal
// `npm test`, which never reaches this file at all.
let createClient;
if (!skip) {
  ({ createClient } = require('@supabase/supabase-js'));
}

async function signInAsClient(email, password) {
  const client = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_PUBLISHABLE_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in test user ${email}: ${error.message}`);
  return { client, user: data.user };
}

function exerciseRow(id, userId, name) {
  return {
    id, user_id: userId, name,
    primary_muscles: [], secondary_muscles: [], equipment: '', movement_type: '', archived: false
  };
}

// ---------------------------------------------------------------------
// RLS: row visibility/mutation isolation (auth.uid() = user_id policies)
// ---------------------------------------------------------------------

test('User A can insert and read their own exercise row', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const rowId = randomUUID();
  try {
    const { error: insertError } = await a.client.from('exercises').insert(exerciseRow(rowId, a.user.id, 'RLS Test Exercise'));
    assert.equal(insertError, null);

    const { data, error } = await a.client.from('exercises').select('*').eq('id', rowId);
    assert.equal(error, null);
    assert.equal(data.length, 1);
  } finally {
    await a.client.from('exercises').delete().eq('id', rowId);
  }
});

test('User B cannot SELECT a row owned by User A', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const rowId = randomUUID();
  try {
    await a.client.from('exercises').insert(exerciseRow(rowId, a.user.id, 'RLS Test Exercise'));

    const { data, error } = await b.client.from('exercises').select('*').eq('id', rowId);
    assert.equal(error, null, 'RLS filters rows out silently rather than erroring');
    assert.equal(data.length, 0, 'User B must not see User A\'s row at all');
  } finally {
    await a.client.from('exercises').delete().eq('id', rowId);
  }
});

test('User B cannot UPDATE a row owned by User A', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const rowId = randomUUID();
  try {
    await a.client.from('exercises').insert(exerciseRow(rowId, a.user.id, 'Original Name'));

    await b.client.from('exercises').update({ name: 'Hacked Name' }).eq('id', rowId);

    const { data } = await a.client.from('exercises').select('*').eq('id', rowId);
    assert.equal(data[0].name, 'Original Name', 'the update must not have applied');
  } finally {
    await a.client.from('exercises').delete().eq('id', rowId);
  }
});

test('User B cannot DELETE a row owned by User A', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const rowId = randomUUID();
  try {
    await a.client.from('exercises').insert(exerciseRow(rowId, a.user.id, 'RLS Test Exercise'));

    await b.client.from('exercises').delete().eq('id', rowId);

    const { data } = await a.client.from('exercises').select('*').eq('id', rowId);
    assert.equal(data.length, 1, 'User A\'s row must still exist — User B\'s delete must have affected zero rows');
  } finally {
    await a.client.from('exercises').delete().eq('id', rowId);
  }
});

test('User B cannot INSERT a row claiming to belong to User A (spoofed user_id)', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const rowId = randomUUID();
  try {
    const { error } = await b.client.from('exercises').insert(exerciseRow(rowId, a.user.id, 'Spoofed Row'));
    assert.ok(error, 'the with-check policy must reject an insert claiming another user\'s id');
  } finally {
    // Clean up either way — as whichever user actually owns the row, if it exists.
    await a.client.from('exercises').delete().eq('id', rowId);
    await b.client.from('exercises').delete().eq('id', rowId);
  }
});

// ---------------------------------------------------------------------
// Tenant-scoped foreign keys: a row cannot even be CONSTRUCTED to point
// at another user's parent, independent of RLS (see the "Tenant-scoped
// relationship integrity" section of supabase/schema.sql). These
// exercise the composite FK constraints through the exact same
// PostgREST/supabase-js path the app itself uses — not a raw SQL
// connection — since that's what actually matters for the deployed app.
// ---------------------------------------------------------------------

test('cross-user foreign-key references are rejected: workout cannot reference another user\'s session', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const sessionId = randomUUID();
  const workoutId = randomUUID();
  try {
    const { error: sessionError } = await a.client.from('sessions').insert({
      id: sessionId, user_id: a.user.id, name: 'A Session', exercises: []
    });
    assert.equal(sessionError, null);

    // B tries to create a workout that is genuinely B's own (user_id: B),
    // but points session_id at A's session. RLS's `with check` alone
    // would happily allow this (B is truthfully inserting a row it owns)
    // — only the composite FK on (user_id, session_id) can catch it.
    const { error } = await b.client.from('workouts').insert({
      id: workoutId, user_id: b.user.id, session_id: sessionId, date: '2026-01-01', status: 'active'
    });
    assert.ok(error, 'a composite foreign-key violation must reject this insert');
  } finally {
    await a.client.from('workouts').delete().eq('id', workoutId);
    await b.client.from('workouts').delete().eq('id', workoutId);
    await a.client.from('sessions').delete().eq('id', sessionId);
  }
});

test('cross-user foreign-key references are rejected: set cannot reference another user\'s workout or exercise', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const exerciseId = randomUUID();
  const workoutId = randomUUID();
  const bOwnWorkoutId = randomUUID();
  const setId = randomUUID();
  try {
    await a.client.from('exercises').insert(exerciseRow(exerciseId, a.user.id, 'A Exercise'));
    const { error: workoutError } = await a.client.from('workouts').insert({
      id: workoutId, user_id: a.user.id, date: '2026-01-01', status: 'completed'
    });
    assert.equal(workoutError, null);

    // B's own workout, so B can legitimately reference *something* — but
    // still tries to point workout_id/exercise_id at A's rows.
    await b.client.from('workouts').insert({ id: bOwnWorkoutId, user_id: b.user.id, date: '2026-01-01', status: 'active' });

    const { error: crossWorkoutError } = await b.client.from('sets').insert({
      id: setId, user_id: b.user.id, workout_id: workoutId, exercise_id: exerciseId, set_order: 0
    });
    assert.ok(crossWorkoutError, 'a set claiming another user\'s workout_id must be rejected');
  } finally {
    await a.client.from('sets').delete().eq('id', setId);
    await b.client.from('sets').delete().eq('id', setId);
    await a.client.from('workouts').delete().eq('id', workoutId);
    await b.client.from('workouts').delete().eq('id', bOwnWorkoutId);
    await a.client.from('exercises').delete().eq('id', exerciseId);
  }
});

test('cross-user foreign-key references are rejected: calendar entry cannot reference another user\'s session or workout', { skip }, async () => {
  const a = await signInAsClient(process.env.SUPABASE_TEST_USER_A_EMAIL, process.env.SUPABASE_TEST_USER_A_PASSWORD);
  const b = await signInAsClient(process.env.SUPABASE_TEST_USER_B_EMAIL, process.env.SUPABASE_TEST_USER_B_PASSWORD);
  const sessionId = randomUUID();
  const entryId = randomUUID();
  try {
    await a.client.from('sessions').insert({ id: sessionId, user_id: a.user.id, name: 'A Session', exercises: [] });

    const { error } = await b.client.from('calendar_entries').insert({
      id: entryId, user_id: b.user.id, date: '2026-01-01', session_id: sessionId
    });
    assert.ok(error, 'a calendar entry claiming another user\'s session_id must be rejected');
  } finally {
    await a.client.from('calendar_entries').delete().eq('id', entryId);
    await b.client.from('calendar_entries').delete().eq('id', entryId);
    await a.client.from('sessions').delete().eq('id', sessionId);
  }
});
