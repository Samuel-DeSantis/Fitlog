const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('categoryForMuscle maps fine-grained muscles to their broad category', () => {
  const App = freshApp();
  assert.equal(App.muscleGroups.categoryForMuscle('chest'), 'Chest');
  assert.equal(App.muscleGroups.categoryForMuscle('lats'), 'Back');
  assert.equal(App.muscleGroups.categoryForMuscle('triceps'), 'Arms');
  assert.equal(App.muscleGroups.categoryForMuscle('quads'), 'Legs');
  assert.equal(App.muscleGroups.categoryForMuscle('abs'), 'Core');
  assert.equal(App.muscleGroups.categoryForMuscle('shoulders'), 'Shoulders');
  assert.equal(App.muscleGroups.categoryForMuscle('not-a-real-muscle'), null);
});

test('"All" matches every exercise regardless of muscles', () => {
  const App = freshApp();
  assert.equal(App.muscleGroups.matchesCategory({ primaryMuscles: [], secondaryMuscles: [] }, 'All'), true);
  assert.equal(App.muscleGroups.matchesCategory({ primaryMuscles: ['chest'] }, undefined), true);
});

test('a single-primary-muscle exercise matches only its own category', () => {
  const App = freshApp();
  const ex = { primaryMuscles: ['quads'], secondaryMuscles: [] };
  assert.equal(App.muscleGroups.matchesCategory(ex, 'Legs'), true);
  assert.equal(App.muscleGroups.matchesCategory(ex, 'Chest'), false);
  assert.equal(App.muscleGroups.matchesCategory(ex, 'Back'), false);
});

test('a multi-muscle exercise matches EVERY category its primary or secondary muscles touch', () => {
  const App = freshApp();
  const benchPress = { primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'] };
  assert.equal(App.muscleGroups.matchesCategory(benchPress, 'Chest'), true);
  assert.equal(App.muscleGroups.matchesCategory(benchPress, 'Arms'), true);
  assert.equal(App.muscleGroups.matchesCategory(benchPress, 'Shoulders'), true);
  assert.equal(App.muscleGroups.matchesCategory(benchPress, 'Legs'), false);
  assert.equal(App.muscleGroups.matchesCategory(benchPress, 'Back'), false);

  const categories = App.muscleGroups.exerciseCategories(benchPress);
  assert.equal(categories.size, 3);
  assert.ok(categories.has('Chest') && categories.has('Arms') && categories.has('Shoulders'));
});

test('exercises with no metadata (legacy/custom) match only "All", never a specific category', () => {
  const App = freshApp();
  const bare = { primaryMuscles: undefined, secondaryMuscles: undefined };
  assert.equal(App.muscleGroups.matchesCategory(bare, 'All'), true);
  assert.equal(App.muscleGroups.matchesCategory(bare, 'Chest'), false, 'no crash, no false match, for missing metadata');
});
