window.App = window.App || {};

App.muscleGroups = (function () {
  // Fine-grained muscle tags live on exercises (primaryMuscles/
  // secondaryMuscles). This is a flat lookup from each tag to the ONE
  // broad category used for the picker's filter chips — not a nested
  // hierarchy, just a dictionary.
  const MUSCLE_TO_CATEGORY = {
    chest: 'Chest',
    back: 'Back', lats: 'Back', traps: 'Back',
    shoulders: 'Shoulders',
    biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
    quads: 'Legs', hamstrings: 'Legs', glutes: 'Legs', calves: 'Legs',
    abs: 'Core', obliques: 'Core'
  };

  const CATEGORIES = ['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];

  function categoryForMuscle(muscle) {
    return MUSCLE_TO_CATEGORY[muscle] || null;
  }

  function exerciseCategories(exercise) {
    const muscles = [...(exercise.primaryMuscles || []), ...(exercise.secondaryMuscles || [])];
    const cats = new Set();
    muscles.forEach((m) => {
      const c = categoryForMuscle(m);
      if (c) cats.add(c);
    });
    return cats;
  }

  function matchesCategory(exercise, category) {
    if (!category || category === 'All') return true;
    return exerciseCategories(exercise).has(category);
  }

  return { MUSCLE_TO_CATEGORY, CATEGORIES, categoryForMuscle, exerciseCategories, matchesCategory };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.muscleGroups;
