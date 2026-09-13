window.App = window.App || {};

// Name -> metadata for every exercise in the default library. Used both to
// seed a fresh install and to backfill metadata onto exercises that
// already existed before this feature (matched by name; anything that
// doesn't match — a user's own custom exercise — gets empty defaults
// instead, never a guess).
App.exerciseSeedData = [
  { name: 'Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: 'barbell', movementType: 'horizontal_push' },
  { name: 'Incline Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: 'barbell', movementType: 'horizontal_push' },
  { name: 'Dumbbell Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: 'dumbbell', movementType: 'horizontal_push' },
  { name: 'Push-up', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: 'bodyweight', movementType: 'horizontal_push' },
  { name: 'Squat', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'barbell', movementType: 'squat' },
  { name: 'Romanian Deadlift', primaryMuscles: ['hamstrings'], secondaryMuscles: ['glutes', 'back'], equipment: 'barbell', movementType: 'hinge' },
  { name: 'Leg Press', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'machine', movementType: 'squat' },
  { name: 'Leg Curl', primaryMuscles: ['hamstrings'], secondaryMuscles: [], equipment: 'machine', movementType: 'isolation' },
  { name: 'Calf Raise', primaryMuscles: ['calves'], secondaryMuscles: [], equipment: 'machine', movementType: 'isolation' },
  { name: 'Deadlift', primaryMuscles: ['back'], secondaryMuscles: ['hamstrings', 'glutes'], equipment: 'barbell', movementType: 'hinge' },
  { name: 'Barbell Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: 'barbell', movementType: 'horizontal_pull' },
  { name: 'Lat Pulldown', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'], equipment: 'cable', movementType: 'vertical_pull' },
  { name: 'Pull-up', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'], equipment: 'bodyweight', movementType: 'vertical_pull' },
  { name: 'Chin-up', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'], equipment: 'bodyweight', movementType: 'vertical_pull' },
  { name: 'Overhead Press', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: 'barbell', movementType: 'vertical_push' },
  { name: 'Dumbbell Shoulder Press', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: 'dumbbell', movementType: 'vertical_push' },
  { name: 'Face Pull', primaryMuscles: ['shoulders'], secondaryMuscles: ['back'], equipment: 'cable', movementType: 'horizontal_pull' },
  { name: 'Barbell Curl', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: 'barbell', movementType: 'isolation' },
  { name: 'Dumbbell Curl', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Tricep Pushdown', primaryMuscles: ['triceps'], secondaryMuscles: [], equipment: 'cable', movementType: 'isolation' },
  { name: 'Plank', primaryMuscles: ['abs'], secondaryMuscles: [], equipment: 'bodyweight', movementType: 'core' }
];

if (typeof module !== 'undefined' && module.exports) module.exports = App.exerciseSeedData;
