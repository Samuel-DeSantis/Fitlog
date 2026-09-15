const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

// Note: the Edit Details sheet is the one modal in the app that's a real
// <form> submitted via a type="submit" button (every other modal uses a
// plain type="button" + click listener). The shared click() helper only
// dispatches a synthetic click event, which doesn't trigger a browser's
// implicit form-submission behavior — so submitting it here uses the
// button's native .click() instead, which does.

test('Workout UX: notes are accessible via a small preview without dominating the screen, and remain editable', async () => {
  const { document } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);

  assert.equal(document.getElementById('notes-preview-btn'), null, 'no notes yet — no preview shown');

  click(document.getElementById('edit-meta-btn'));
  await wait(20);
  setValue(document.querySelector('#mf-notes'), 'Felt strong today, bumped up the incline bench.');
  document.querySelector('#meta-form button[type="submit"]').click();
  await wait(30);

  const notesBtn = document.getElementById('notes-preview-btn');
  assert.ok(notesBtn, 'a notes preview should appear once notes exist');
  assert.match(notesBtn.textContent, /Felt strong today/);

  // Tapping the preview reopens the SAME editor, focused on notes —
  // not a separate notes-only UI.
  click(notesBtn);
  await wait(20);
  const notesField = document.querySelector('#mf-notes');
  assert.ok(notesField, 'tapping the preview opens the same Edit Details form');
  assert.ok(document.querySelector('#mf-title'), 'the full editor (title/date/notes) opens, not a notes-only dialog');
  assert.equal(document.activeElement, notesField, 'the notes field should be focused immediately');
});

test('Workout UX: a very long note is truncated in the preview but saved in full', async () => {
  const { document, App } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  const workoutId = document.location.hash.replace('#/workout/', '');

  const longNote = 'A'.repeat(200);
  click(document.getElementById('edit-meta-btn'));
  await wait(20);
  setValue(document.querySelector('#mf-notes'), longNote);
  document.querySelector('#meta-form button[type="submit"]').click();
  await wait(30);

  const notesBtn = document.getElementById('notes-preview-btn');
  assert.ok(notesBtn.textContent.length < longNote.length, 'the preview line should be visibly shorter than the full note');

  const workout = await App.queries.getWorkout(workoutId);
  assert.equal(workout.notes, longNote, 'the full note must still be saved untruncated');
});

test('Historical editing: editing a completed workout (sets, exercises, meta, order) never flips it back to active', async () => {
  const { document, App } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  const workoutId = document.location.hash.replace('#/workout/', '');

  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '135');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350);
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  let w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed');

  // Reopen it for editing, the same way Calendar would.
  document.location.hash = '/workout/' + workoutId;
  await wait(30);
  assert.ok(document.getElementById('save-btn'), 'reopening a completed workout lands in the same editor, in edit mode');

  setValue(document.querySelector('.set-weight'), '140');
  await wait(350);
  w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed', 'editing a set value must not reactivate the workout');

  click(document.querySelector('.btn-add-set'));
  await wait(30);
  w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed', 'adding a set must not reactivate the workout');

  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Squat');
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
  w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed', 'adding an exercise must not reactivate the workout');

  click(document.getElementById('edit-meta-btn'));
  await wait(20);
  setValue(document.querySelector('#mf-title'), 'Upper Body (edited)');
  document.querySelector('#meta-form button[type="submit"]').click();
  await wait(30);
  w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed', 'editing meta must not reactivate the workout');
  assert.equal(w.title, 'Upper Body (edited)');

  const blocks = document.querySelectorAll('.exercise-block');
  assert.equal(blocks.length, 2);
  click(blocks[1].querySelector('.exercise-reorder-btn[data-dir="up"]'));
  await wait(20);
  w = await App.queries.getWorkout(workoutId);
  assert.equal(w.status, 'completed', 'reordering exercises must not reactivate the workout');

  const active = await App.queries.getActiveWorkout();
  assert.equal(active, null, 'no workout should have become active as a side effect of editing history');
});
