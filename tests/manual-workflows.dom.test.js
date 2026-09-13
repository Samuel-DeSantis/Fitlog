const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, click, setValue, wait } = require('./helpers/domSetup');

test('Manual Test A (real DOM): log a workout end to end', async () => {
  const { document } = await bootRealApp();

  const logBtn = document.getElementById('log-workout-btn');
  assert.ok(logBtn, 'Today should offer "+ Log Workout" when nothing is logged yet');
  click(logBtn);
  await wait(30);

  assert.match(document.location.hash, /^#\/workout\//, 'should land on the workout screen');
  assert.ok(document.getElementById('finish-workout-btn'));

  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), 'Bench');
  await wait(20);
  const item = document.querySelector('.modal-list-item');
  assert.ok(item, 'Bench Press should be found via the real search picker');
  click(item);
  await wait(30);

  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '135');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350); // debounced save

  assert.ok(!document.querySelector('.set-row').classList.contains('set-row-planned'), 'a fully entered set should read as completed');

  click(document.getElementById('finish-workout-btn'));
  await wait(40);

  assert.equal(document.location.hash, '#/today');
  assert.ok(!document.getElementById('log-workout-btn'), 'empty-state CTA should be gone once a workout is logged');
  assert.match(document.body.textContent, /135×8/, "today's completed-workout summary should show the logged set");
});

test('Manual Test C (real DOM): edit a completed workout — modify, add, delete a set, reload, verify', async () => {
  const { document, App } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
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

  // Open it from Calendar, exactly like a real user would: navigate to
  // today's cell in the month grid, then View Workout from the day sheet.
  document.location.hash = '/calendar';
  await wait(30);
  const todayStr = App.utils.todayLocalISO();
  click(document.querySelector(`.calendar-day[data-date="${todayStr}"]`));
  await wait(30);
  click(document.querySelector('[data-view-workout]'));
  await wait(30);
  assert.ok(document.getElementById('save-btn'), 'a completed workout opens in edit mode');

  // Modify the existing set.
  setValue(document.querySelector('.set-weight'), '140');
  await wait(350);

  // Add a second set.
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  const rows = document.querySelectorAll('.set-row');
  setValue(rows[1].querySelector('.set-weight'), '140');
  setValue(rows[1].querySelector('.set-reps'), '6');
  await wait(350);

  const workoutId = document.location.hash.replace('#/workout/', '');
  let sets = await App.queries.getSetsForWorkout(workoutId);
  assert.equal(sets.length, 2);

  // Delete the second set via its own remove button.
  document.querySelectorAll('.set-row')[1].querySelector('.set-remove').click();
  await wait(30);

  sets = await App.queries.getSetsForWorkout(workoutId);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].weight, 140, 'the edited weight persisted');

  click(document.getElementById('save-btn'));
  await wait(30);
  assert.equal(document.location.hash, '#/calendar');

  // Reload and verify everything survived.
  const { reopenRealApp } = require('./helpers/domSetup');
  const reopened = await reopenRealApp();
  const afterReload = await reopened.App.queries.getSetsForWorkout(workoutId);
  assert.equal(afterReload.length, 1);
  assert.equal(afterReload[0].weight, 140);
  assert.equal(afterReload[0].reps, 8, 'unrelated field untouched by the weight-only edit');
});

test('Manual Test B (real DOM): start, navigate away and back, reload, resume, finish', async () => {
  const { bootRealApp, reopenRealApp, click, setValue, wait } = require('./helpers/domSetup');
  const harness1 = await bootRealApp();
  click(harness1.document.getElementById('log-workout-btn'));
  await wait(30);
  const workoutUrl = harness1.document.location.hash;

  click(harness1.document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(harness1.document.querySelector('.modal-search'), 'Squat');
  await wait(20);
  click(harness1.document.querySelector('.modal-list-item'));
  await wait(30);

  // Navigate to Today, then back to Train — must show the SAME workout,
  // never create a second one.
  harness1.document.location.hash = '/today';
  await wait(30);
  harness1.document.location.hash = '/train';
  await wait(30);
  const resumeBtn = harness1.document.getElementById('resume-btn');
  assert.ok(resumeBtn, 'Train should offer to resume, not start fresh');
  click(resumeBtn);
  await wait(30);
  assert.equal(harness1.document.location.hash, workoutUrl, 'resuming from Train must reopen the SAME workout');

  // Simulate closing and reopening the app entirely (same underlying data,
  // fresh DOM/JS — a real reload).
  const harness2 = await reopenRealApp();
  const activeAfterReload = await harness2.App.queries.getActiveWorkout();
  assert.ok(activeAfterReload, 'the active workout must survive a reload');
  assert.equal('#/workout/' + activeAfterReload.id, workoutUrl);

  await harness2.App.commands.finishWorkout(activeAfterReload.id);
  const stillActive = await harness2.App.queries.getActiveWorkout();
  assert.equal(stillActive, null, 'finishing should clear the active slot');
});

test('Manual Test D (real DOM): finishing workout A allows explicitly starting workout B', async () => {
  const { document, App } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);
  const workoutAId = document.location.hash.replace('#/workout/', '');
  click(document.getElementById('finish-workout-btn'));
  await wait(30);

  // Back on Today, a completed workout is shown (not the empty-state CTA —
  // that's correct: Today only offers "+ Log Workout" when nothing is
  // logged yet). Starting a second same-day workout is Train's job.
  document.location.hash = '/train';
  await wait(30);
  const newWorkoutBtn = document.getElementById('new-workout-btn');
  assert.ok(newWorkoutBtn, 'Train should offer + New Workout once nothing is active');
  click(newWorkoutBtn);
  await wait(30);
  const workoutBId = document.location.hash.replace('#/workout/', '');

  assert.notEqual(workoutAId, workoutBId);
  const a = await App.queries.getWorkout(workoutAId);
  const b = await App.queries.getWorkout(workoutBId);
  assert.equal(a.status, 'completed');
  assert.equal(b.status, 'active');
});

test('Manual escaping check (real DOM): a malicious exercise name renders as inert text, not markup', async () => {
  const { document, App, window } = await bootRealApp();
  const evil = `"><img src=x onerror="window.__pwned=true">`;
  await App.commands.createExercise(evil);

  window.__pwned = false;
  document.location.hash = '/more';
  await wait(30);

  assert.equal(window.__pwned, false, 'the payload must never execute');
  assert.ok(document.body.textContent.includes(evil), 'the literal text should still be visible, just inert');
  assert.equal(document.querySelectorAll('img[src="x"]').length, 0, 'no injected element should exist in the DOM');
});

