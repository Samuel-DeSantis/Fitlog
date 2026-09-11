window.App = window.App || {};

App.seed = {
  exercises: [
    'Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Push-up',
    'Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Calf Raise',
    'Deadlift', 'Barbell Row', 'Lat Pulldown', 'Pull-up', 'Chin-up',
    'Overhead Press', 'Dumbbell Shoulder Press', 'Face Pull',
    'Barbell Curl', 'Dumbbell Curl', 'Tricep Pushdown', 'Plank'
  ]
};

App.ensureSeed = async function () {
  const settings = await App.db.get('settings', 'app');
  if (settings && settings.seeded) return;

  for (const name of App.seed.exercises) {
    await App.commands.createExercise(name);
  }

  const base = settings || { id: 'app', unit: 'lb', bodyweight: null };
  base.seeded = true;
  await App.db.put('settings', base);
};
