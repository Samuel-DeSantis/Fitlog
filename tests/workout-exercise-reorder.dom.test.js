const test = require('node:test');
const assert = require('node:assert/strict');
const { bootRealApp, reopenRealApp, click, setValue, wait } = require('./helpers/domSetup');

async function addExercise(document, name) {
  click(document.getElementById('add-exercise-btn'));
  await wait(20);
  setValue(document.querySelector('.modal-search'), name);
  await wait(20);
  click(document.querySelector('.modal-list-item'));
  await wait(30);
}

test('Workout UX: exercises can be reordered with up/down, boundaries disable correctly, and the order persists', async () => {
  const { document } = await bootRealApp();

  click(document.getElementById('log-workout-btn'));
  await wait(30);

  await addExercise(document, 'Bench');
  await addExercise(document, 'Squat');
  await addExercise(document, 'Deadlift');

  const names = () => [...document.querySelectorAll('.exercise-name')].map(n => n.textContent.replace(/^\d+\.\s*/, ''));
  assert.deepEqual(names(), ['Bench Press', 'Squat', 'Deadlift']);

  let blocks = document.querySelectorAll('.exercise-block');
  assert.ok(blocks[0].querySelector('.exercise-reorder-btn[data-dir="up"]').disabled, 'the first exercise cannot move up');
  assert.ok(!blocks[0].querySelector('.exercise-reorder-btn[data-dir="down"]').disabled);
  assert.ok(!blocks[1].querySelector('.exercise-reorder-btn[data-dir="up"]').disabled);
  assert.ok(blocks[2].querySelector('.exercise-reorder-btn[data-dir="down"]').disabled, 'the last exercise cannot move down');

  // Move Squat (index 1) up, ahead of Bench Press.
  click(blocks[1].querySelector('.exercise-reorder-btn[data-dir="up"]'));
  await wait(20);
  assert.deepEqual(names(), ['Squat', 'Bench Press', 'Deadlift']);

  // Move Deadlift (now last) up twice, to the front.
  blocks = document.querySelectorAll('.exercise-block');
  click(blocks[2].querySelector('.exercise-reorder-btn[data-dir="up"]'));
  await wait(20);
  blocks = document.querySelectorAll('.exercise-block');
  click(blocks[1].querySelector('.exercise-reorder-btn[data-dir="up"]'));
  await wait(20);
  assert.deepEqual(names(), ['Deadlift', 'Squat', 'Bench Press']);

  blocks = document.querySelectorAll('.exercise-block');
  assert.ok(blocks[0].querySelector('.exercise-reorder-btn[data-dir="up"]').disabled, 'boundary state should follow the new order');
  assert.ok(blocks[2].querySelector('.exercise-reorder-btn[data-dir="down"]').disabled);

  // Persist across a full reload.
  const workoutId = document.location.hash.replace('#/workout/', '');
  const reopened = await reopenRealApp();
  const workout = await reopened.App.queries.getWorkout(workoutId);
  const exercises = await reopened.App.queries.getExercises(true);
  const exNameById = Object.fromEntries(exercises.map(e => [e.id, e.name]));
  assert.deepEqual(workout.exerciseOrder.map(id => exNameById[id]), ['Deadlift', 'Squat', 'Bench Press']);
});

test('Reordering exercises never touches logged sets on any exercise', async () => {
  const { document, App } = await bootRealApp();
  click(document.getElementById('log-workout-btn'));
  await wait(30);
  const workoutId = document.location.hash.replace('#/workout/', '');

  await addExercise(document, 'Bench');
  click(document.querySelector('.btn-add-set'));
  await wait(30);
  setValue(document.querySelector('.set-weight'), '135');
  setValue(document.querySelector('.set-reps'), '8');
  await wait(350);

  await addExercise(document, 'Squat');

  const blocks = document.querySelectorAll('.exercise-block');
  const benchId = [...blocks].find(b => b.textContent.includes('Bench')).dataset.exercise;
  click(blocks[1].querySelector('.exercise-reorder-btn[data-dir="up"]'));
  await wait(20);

  const sets = await App.queries.getSetsForWorkoutExercise(workoutId, benchId);
  assert.equal(sets.length, 1, "Bench's own logged set must survive being reordered");
  assert.equal(sets[0].weight, 135);
  assert.equal(sets[0].reps, 8);
});
