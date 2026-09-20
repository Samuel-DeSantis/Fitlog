const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

async function openTrain(document) {
  document.location.hash = '/train';
  await wait(40);
}

async function addExerciseToSessionEditor(document, name) {
  click(document.getElementById('session-add-exercise'));
  await wait(30);
  setValue(document.querySelector('.modal-search'), name);
  await wait(30);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
}

function prescriptionRowFor(document, exerciseName) {
  return [...document.querySelectorAll('.session-exercise-row')]
    .find(row => row.querySelector('.list-row-title').textContent.includes(exerciseName));
}

function setPrescription(row, { targetSets, repMin, repMax }) {
  if (targetSets !== undefined) setValue(row.querySelector('[data-field="targetSets"]'), String(targetSets));
  if (repMin !== undefined) setValue(row.querySelector('[data-field="repMin"]'), String(repMin));
  if (repMax !== undefined) setValue(row.querySelector('[data-field="repMax"]'), String(repMax));
}

function readPrescription(row) {
  const val = (field) => {
    const v = row.querySelector(`[data-field="${field}"]`).value;
    return v === '' ? null : Number(v);
  };
  return { targetSets: val('targetSets'), repMin: val('repMin'), repMax: val('repMax') };
}

// ---------------------------------------------------------------------
// 1, 2, 3. Create with prescriptions, edit them, and reopening the
// editor shows the same (persisted) values.
// ---------------------------------------------------------------------

test('Session editor: create a Session with per-exercise prescriptions, then edit and re-open it', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');

  await addExerciseToSessionEditor(document, 'Bench');
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 5, repMax: 8 });

  await addExerciseToSessionEditor(document, 'Barbell Row');
  setPrescription(prescriptionRowFor(document, 'Barbell Row'), { targetSets: 4, repMin: 6, repMax: 10 });

  click(document.getElementById('session-save'));
  await wait(40);

  let session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  assert.ok(session, 'the session should have been created');
  const bench = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Bench Press'));
  const row = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Barbell Row'));
  assert.deepEqual(session.exercises.find(e => e.exerciseId === bench.id), { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(session.exercises.find(e => e.exerciseId === row.id), { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 });

  // Re-open (Modify) — the inputs should show the persisted values, not
  // be blank, proving the editor loads existing prescriptions correctly.
  document.querySelector(`[data-modify="${session.id}"]`).click();
  await wait(30);
  assert.deepEqual(readPrescription(prescriptionRowFor(document, 'Bench Press')), { targetSets: 3, repMin: 5, repMax: 8 });
  assert.deepEqual(readPrescription(prescriptionRowFor(document, 'Barbell Row')), { targetSets: 4, repMin: 6, repMax: 10 });

  // Edit a value and save again — it should persist.
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 5 });
  click(document.getElementById('session-save'));
  await wait(40);

  session = await App.queries.getSession(session.id);
  assert.deepEqual(session.exercises.find(e => e.exerciseId === bench.id), { exerciseId: bench.id, targetSets: 5, repMin: 5, repMax: 8 });
});

// ---------------------------------------------------------------------
// 4. Reordering keeps each prescription attached to its own exercise —
// never swapped by position.
// ---------------------------------------------------------------------

test('Session editor: reordering exercises keeps each prescription attached to the correct exercise', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');

  await addExerciseToSessionEditor(document, 'Bench');
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 5, repMax: 8 });
  await addExerciseToSessionEditor(document, 'Barbell Row');
  setPrescription(prescriptionRowFor(document, 'Barbell Row'), { targetSets: 4, repMin: 6, repMax: 10 });

  // Move Barbell Row (currently 2nd) up, ahead of Bench Press.
  const rowRow = prescriptionRowFor(document, 'Barbell Row');
  click(rowRow.querySelector('[data-move-up]'));
  await wait(20);

  // The DOM itself, right after reordering (before any save), should show
  // each exercise's OWN prescription following it, not a positional swap.
  const rows = document.querySelectorAll('.session-exercise-row');
  assert.ok(rows[0].querySelector('.list-row-title').textContent.includes('Barbell Row'));
  assert.deepEqual(readPrescription(rows[0]), { targetSets: 4, repMin: 6, repMax: 10 });
  assert.ok(rows[1].querySelector('.list-row-title').textContent.includes('Bench Press'));
  assert.deepEqual(readPrescription(rows[1]), { targetSets: 3, repMin: 5, repMax: 8 });

  click(document.getElementById('session-save'));
  await wait(40);

  const session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  const bench = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Bench Press'));
  const row = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Barbell Row'));
  assert.equal(session.exercises[0].exerciseId, row.id, 'Barbell Row should be first after reordering');
  assert.deepEqual(session.exercises[0], { exerciseId: row.id, targetSets: 4, repMin: 6, repMax: 10 });
  assert.deepEqual(session.exercises[1], { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
});

// ---------------------------------------------------------------------
// 5. Removing an exercise removes its prescription with it.
// ---------------------------------------------------------------------

test('Session editor: removing an exercise removes its prescription entirely', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');
  await addExerciseToSessionEditor(document, 'Bench');
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 5, repMax: 8 });
  await addExerciseToSessionEditor(document, 'Barbell Row');
  setPrescription(prescriptionRowFor(document, 'Barbell Row'), { targetSets: 4, repMin: 6, repMax: 10 });

  click(prescriptionRowFor(document, 'Bench Press').querySelector('[data-remove]'));
  await wait(20);
  assert.equal(prescriptionRowFor(document, 'Bench Press'), undefined, 'the row should be gone from the editor immediately');

  click(document.getElementById('session-save'));
  await wait(40);

  const session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  assert.equal(session.exercises.length, 1);
  assert.equal(session.exercises[0].targetSets, 4, "the remaining exercise's prescription is untouched");
  const bench = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Bench Press'));
  assert.equal(session.exercises.some(e => e.exerciseId === bench.id), false, "Bench Press's prescription must not linger anywhere");
});

// ---------------------------------------------------------------------
// 6. Adding a new exercise leaves existing prescriptions untouched.
// ---------------------------------------------------------------------

test('Session editor: adding a new exercise does not disturb existing prescriptions', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');
  await addExerciseToSessionEditor(document, 'Bench');
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 5, repMax: 8 });
  click(document.getElementById('session-save'));
  await wait(40);

  let session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  document.querySelector(`[data-modify="${session.id}"]`).click();
  await wait(30);

  // Add Barbell Row without touching its prescription at all.
  await addExerciseToSessionEditor(document, 'Barbell Row');
  click(document.getElementById('session-save'));
  await wait(40);

  session = await App.queries.getSession(session.id);
  const bench = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Bench Press'));
  const row = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Barbell Row'));
  assert.deepEqual(session.exercises.find(e => e.exerciseId === bench.id), { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 }, "Bench Press's prescription must be unchanged");
  assert.deepEqual(session.exercises.find(e => e.exerciseId === row.id), { exerciseId: row.id, targetSets: null, repMin: null, repMax: null }, 'the newly added exercise defaults to no prescription (Phase 4.1 default)');
});

// ---------------------------------------------------------------------
// 7. A pre-4.2/4.1 Session (no prescriptions) opens and renders cleanly.
// ---------------------------------------------------------------------

test('Session editor: an existing Session with no prescriptions renders with blank (not broken) inputs', async () => {
  const { document, App } = await bootRealApp();
  const bench = await App.commands.createExercise('Bench Press');
  const row = await App.commands.createExercise('Barbell Row');
  // Bare exerciseId strings — exactly what every Session looked like
  // before Phase 4.1/4.2.
  const session = await App.commands.createSession('Legacy Upper', [bench.id, row.id], 'blue');

  await openTrain(document);
  document.querySelector(`[data-modify="${session.id}"]`).click();
  await wait(30);

  const benchRow = prescriptionRowFor(document, 'Bench Press');
  const rowRow = prescriptionRowFor(document, 'Barbell Row');
  assert.ok(benchRow && rowRow, 'both exercises should render without error');
  assert.deepEqual(readPrescription(benchRow), { targetSets: null, repMin: null, repMax: null });
  assert.deepEqual(readPrescription(rowRow), { targetSets: null, repMin: null, repMax: null });
  // Nothing like the literal string "null" or "undefined" should leak
  // into the input values.
  benchRow.querySelectorAll('.prescription-input').forEach((input) => {
    assert.equal(input.value, '');
  });

  // The user can now set a prescription on a previously-unprescribed
  // session and save normally.
  setPrescription(benchRow, { targetSets: 3, repMin: 5, repMax: 8 });
  click(document.getElementById('session-save'));
  await wait(40);
  const saved = await App.queries.getSession(session.id);
  assert.deepEqual(saved.exercises.find(e => e.exerciseId === bench.id), { exerciseId: bench.id, targetSets: 3, repMin: 5, repMax: 8 });
});

// ---------------------------------------------------------------------
// 8. Invalid prescription values are rejected per Phase 4.1's own
// validation (App.prescriptions.validate) — the save is blocked and
// nothing is persisted.
// ---------------------------------------------------------------------

test('Session editor: an invalid prescription blocks saving with a clear message, and nothing is persisted', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');
  await addExerciseToSessionEditor(document, 'Bench');

  // repMax < repMin.
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 10, repMax: 5 });

  let alertMessage = null;
  global.alert = (msg) => { alertMessage = msg; };
  click(document.getElementById('session-save'));
  await wait(30);

  assert.match(alertMessage, /Bench Press/, 'the message should say which exercise is the problem');
  assert.match(alertMessage, /repMax must be greater than or equal to repMin/);
  assert.ok(document.querySelector('.modal-overlay'), 'the editor should stay open so the value can be fixed');
  assert.equal((await App.queries.getSessions()).length, 0, 'nothing should have been saved');

  // Fix it and save successfully.
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { repMin: 5, repMax: 10 });
  alertMessage = null;
  click(document.getElementById('session-save'));
  await wait(40);
  assert.equal(alertMessage, null);
  assert.equal((await App.queries.getSessions()).length, 1);
});

// ---------------------------------------------------------------------
// 9. Editing a Session's prescriptions never touches historical
// Workouts/Sets.
// ---------------------------------------------------------------------

test('Session editor: editing prescriptions does not modify historical Workouts or Sets', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');
  await addExerciseToSessionEditor(document, 'Bench');
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 3, repMin: 5, repMax: 8 });
  click(document.getElementById('session-save'));
  await wait(40);

  const session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  const bench = await App.queries.getExercises(true).then(list => list.find(e => e.name === 'Bench Press'));

  // Start and log a real workout from this session, with actual
  // performance that ignores the prescription (heavier, fewer reps).
  const workout = await App.commands.startFromSession(session);
  const s1 = await App.commands.addSet(workout.id, bench.id);
  await App.commands.updateSet(s1.id, { weight: 225, reps: 3 });
  await App.commands.finishWorkout(workout.id);

  // Now go change the session's prescription substantially.
  document.querySelector(`[data-modify="${session.id}"]`).click();
  await wait(30);
  setPrescription(prescriptionRowFor(document, 'Bench Press'), { targetSets: 5, repMin: 12, repMax: 15 });
  click(document.getElementById('session-save'));
  await wait(40);

  const reloadedWorkout = await App.queries.getWorkout(workout.id);
  assert.equal(reloadedWorkout.status, 'completed');
  assert.deepEqual(reloadedWorkout.exerciseOrder, [bench.id]);
  const sets = await App.queries.getSetsForWorkoutExercise(workout.id, bench.id);
  // Starting from a prescribed Session now seeds 3 blank sets (Phase
  // 4.3) plus the one explicitly added here — none of that is disturbed
  // by editing the Session's prescription afterward.
  assert.equal(sets.length, 4);
  const loggedSet = sets.find(s => s.weight === 225);
  assert.ok(loggedSet, 'the historical set is untouched by the prescription edit');
  assert.equal(loggedSet.reps, 3);

  const updatedSession = await App.queries.getSession(session.id);
  assert.deepEqual(updatedSession.exercises[0], { exerciseId: bench.id, targetSets: 5, repMin: 12, repMax: 15 });
});

// ---------------------------------------------------------------------
// 10. Session color behavior is unaffected by the editor restructuring.
// ---------------------------------------------------------------------

test('Session editor: color selection still works, saves, and pre-selects correctly on re-open', async () => {
  const { document, App } = await bootRealApp();
  await openTrain(document);

  click(document.getElementById('create-session-btn'));
  await wait(30);
  setValue(document.querySelector('#session-name'), 'Upper Strength');
  document.querySelector('[data-color="red"]').click();
  await addExerciseToSessionEditor(document, 'Bench');
  click(document.getElementById('session-save'));
  await wait(40);

  let session = (await App.queries.getSessions()).find(s => s.name === 'Upper Strength');
  assert.equal(session.color, 'red');

  document.querySelector(`[data-modify="${session.id}"]`).click();
  await wait(30);
  const selectedSwatch = document.querySelector('.color-swatch-selected');
  assert.equal(selectedSwatch.dataset.color, 'red', 'the current color should be pre-selected when re-opening');

  document.querySelector('[data-color="purple"]').click();
  click(document.getElementById('session-save'));
  await wait(40);

  session = await App.queries.getSession(session.id);
  assert.equal(session.color, 'purple');
});
