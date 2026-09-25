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
  { name: 'Plank', primaryMuscles: ['abs'], secondaryMuscles: [], equipment: 'bodyweight', movementType: 'core' },

  // --- Library expansion below. Anything already covered above by an
  // equivalent lift (e.g. Barbell Bench Press ~= Bench Press, Push-Up
  // ~= Push-up) is intentionally left out to avoid near-duplicate
  // entries in the picker. ---

  // Chest
  { name: 'Incline Dumbbell Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: 'dumbbell', movementType: 'horizontal_push' },
  { name: 'Dumbbell Fly', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'], equipment: 'cable', movementType: 'isolation' },
  { name: 'Dip', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: 'bodyweight', movementType: 'horizontal_push' },

  // Back
  { name: 'Dumbbell Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: 'dumbbell', movementType: 'horizontal_pull' },
  { name: 'Chest-Supported Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: 'machine', movementType: 'horizontal_pull' },
  { name: 'Seated Cable Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: 'cable', movementType: 'horizontal_pull' },
  { name: 'Straight-Arm Pulldown', primaryMuscles: ['lats'], secondaryMuscles: [], equipment: 'cable', movementType: 'isolation' },
  { name: 'Machine Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: 'machine', movementType: 'horizontal_pull' },

  // Shoulders
  { name: 'Dumbbell Lateral Raise', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Cable Lateral Raise', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: 'cable', movementType: 'isolation' },
  { name: 'Rear Delt Fly', primaryMuscles: ['shoulders'], secondaryMuscles: ['back'], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Front Raise', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: 'dumbbell', movementType: 'isolation' },

  // Arms
  { name: 'Hammer Curl', primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Incline Dumbbell Curl', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Preacher Curl', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: 'barbell', movementType: 'isolation' },
  { name: 'Cable Curl', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: 'cable', movementType: 'isolation' },
  { name: 'Overhead Triceps Extension', primaryMuscles: ['triceps'], secondaryMuscles: [], equipment: 'dumbbell', movementType: 'isolation' },
  { name: 'Skull Crusher', primaryMuscles: ['triceps'], secondaryMuscles: [], equipment: 'barbell', movementType: 'isolation' },
  { name: 'Close-Grip Bench Press', primaryMuscles: ['triceps'], secondaryMuscles: ['chest', 'shoulders'], equipment: 'barbell', movementType: 'horizontal_push' },

  // Legs
  { name: 'Front Squat', primaryMuscles: ['quads'], secondaryMuscles: ['glutes'], equipment: 'barbell', movementType: 'squat' },
  { name: 'Goblet Squat', primaryMuscles: ['quads'], secondaryMuscles: ['glutes'], equipment: 'dumbbell', movementType: 'squat' },
  { name: 'Bulgarian Split Squat', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'dumbbell', movementType: 'squat' },
  { name: 'Walking Lunge', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'dumbbell', movementType: 'squat' },
  { name: 'Reverse Lunge', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'dumbbell', movementType: 'squat' },
  { name: 'Leg Extension', primaryMuscles: ['quads'], secondaryMuscles: [], equipment: 'machine', movementType: 'isolation' },
  { name: 'Stiff-Leg Deadlift', primaryMuscles: ['hamstrings'], secondaryMuscles: ['glutes', 'back'], equipment: 'barbell', movementType: 'hinge' },
  { name: 'Good Morning', primaryMuscles: ['hamstrings'], secondaryMuscles: ['glutes', 'back'], equipment: 'barbell', movementType: 'hinge' },
  { name: 'Hip Thrust', primaryMuscles: ['glutes'], secondaryMuscles: ['hamstrings'], equipment: 'barbell', movementType: 'hinge' },
  { name: 'Glute Bridge', primaryMuscles: ['glutes'], secondaryMuscles: ['hamstrings'], equipment: 'bodyweight', movementType: 'hinge' },
  { name: 'Seated Calf Raise', primaryMuscles: ['calves'], secondaryMuscles: [], equipment: 'machine', movementType: 'isolation' },

  // Core
  { name: 'Side Plank', primaryMuscles: ['obliques'], secondaryMuscles: ['abs'], equipment: 'bodyweight', movementType: 'core' },
  { name: 'Hanging Leg Raise', primaryMuscles: ['abs'], secondaryMuscles: [], equipment: 'bodyweight', movementType: 'core' },
  { name: 'Cable Crunch', primaryMuscles: ['abs'], secondaryMuscles: [], equipment: 'cable', movementType: 'core' },
  { name: 'Ab Wheel Rollout', primaryMuscles: ['abs'], secondaryMuscles: ['shoulders'], equipment: 'other', movementType: 'core' },
  { name: 'Reverse Crunch', primaryMuscles: ['abs'], secondaryMuscles: [], equipment: 'bodyweight', movementType: 'core' }
];

if (typeof module !== 'undefined' && module.exports) module.exports = App.exerciseSeedData;
