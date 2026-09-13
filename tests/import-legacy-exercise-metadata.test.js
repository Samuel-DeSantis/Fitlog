const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

function legacyPayload(exercises) {
  return {
    meta: { formatVersion: 1, exportedAt: '2025-01-01T00:00:00.000Z' },
    stores: { exercises }
  };
}

test('importing a legacy metadata-less exercise into a v3 database does not crash and produces a v3-shaped record', async () => {
  const App = freshApp();
  const payload = legacyPayload([{ id: 'legacy-1', name: 'Some Exercise', archived: false }]);

  await App.db.importAll(payload, 'merge');

  const imported = await App.db.get('exercises', 'legacy-1');
  assert.ok(imported, 'the record should be imported');
  assert.ok(Array.isArray(imported.primaryMuscles), 'primaryMuscles must exist and be an array');
  assert.ok(Array.isArray(imported.secondaryMuscles));
  assert.equal(typeof imported.equipment, 'string');
  assert.equal(typeof imported.movementType, 'string');
});

test('a legacy KNOWN (seeded) exercise gets its metadata backfilled by name on import', async () => {
  const App = freshApp();
  const payload = legacyPayload([{ id: 'legacy-bench', name: 'Bench Press', archived: false, createdAt: 'x', updatedAt: 'y' }]);

  await App.db.importAll(payload, 'merge');

  const imported = await App.db.get('exercises', 'legacy-bench');
  assert.deepEqual(imported.primaryMuscles, ['chest']);
  assert.deepEqual(imported.secondaryMuscles, ['triceps', 'shoulders']);
  assert.equal(imported.equipment, 'barbell');
  assert.equal(imported.movementType, 'horizontal_push');
  assert.equal(imported.id, 'legacy-bench');
  assert.equal(imported.name, 'Bench Press');
  assert.equal(imported.archived, false);
  assert.equal(imported.createdAt, 'x');
  assert.equal(imported.updatedAt, 'y');
});

test('a legacy CUSTOM (unrecognized) exercise gets empty metadata defaults on import, never a guess', async () => {
  const App = freshApp();
  const payload = legacyPayload([{ id: 'legacy-custom', name: 'My Weird Homemade Move', archived: false }]);

  await App.db.importAll(payload, 'merge');

  const imported = await App.db.get('exercises', 'legacy-custom');
  assert.deepEqual(imported.primaryMuscles, []);
  assert.deepEqual(imported.secondaryMuscles, []);
  assert.equal(imported.equipment, '');
  assert.equal(imported.movementType, '');
  assert.equal(imported.name, 'My Weird Homemade Move');
});

test('MERGE cannot accidentally remove existing metadata: importing a legacy record over a metadata-rich one preserves the existing metadata', async () => {
  const App = freshApp();
  const existing = await App.commands.createExercise('Bench Press', {
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders', 'front_delts'],
    equipment: 'barbell',
    movementType: 'horizontal_push'
  });

  const payload = legacyPayload([{ id: existing.id, name: 'Bench Press', archived: false, createdAt: existing.createdAt, updatedAt: 'stale' }]);
  await App.db.importAll(payload, 'merge');

  const afterMerge = await App.db.get('exercises', existing.id);
  assert.deepEqual(afterMerge.secondaryMuscles, ['triceps', 'shoulders', 'front_delts'], 'existing (richer) metadata must survive the merge, not be blanked or reset to the seed default');
  assert.equal(afterMerge.id, existing.id);
  assert.equal(afterMerge.name, 'Bench Press');
});

test('REPLACE mode still backfills legacy exercises by name (nothing "existing" to preserve after a full replace)', async () => {
  const App = freshApp();
  await App.commands.createExercise('Bench Press', { primaryMuscles: ['should-be-wiped'] });

  const payload = legacyPayload([{ id: 'legacy-bench-2', name: 'Bench Press', archived: false }]);
  await App.db.importAll(payload, 'replace');

  const imported = await App.db.get('exercises', 'legacy-bench-2');
  assert.deepEqual(imported.primaryMuscles, ['chest'], 'replace mode backfills from the seed table since the old record was cleared');
});

test('a v3-shaped exercise in the import (including deliberately empty metadata) passes through unchanged', async () => {
  const App = freshApp();
  const payload = legacyPayload([{
    id: 'v3-custom', name: 'Deliberately Bare Custom Move', archived: false,
    primaryMuscles: [], secondaryMuscles: [], equipment: '', movementType: ''
  }]);

  await App.db.importAll(payload, 'merge');

  const imported = await App.db.get('exercises', 'v3-custom');
  assert.deepEqual(imported.primaryMuscles, [], 'an explicit empty array must not be treated as "legacy/missing"');
});
