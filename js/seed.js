window.App = window.App || {};

App.seed = {
  exercises: [
    { name: 'Bench Press', category: 'Chest', equipment: 'Barbell' },
    { name: 'Incline Bench Press', category: 'Chest', equipment: 'Barbell' },
    { name: 'Dumbbell Bench Press', category: 'Chest', equipment: 'Dumbbell' },
    { name: 'Push-up', category: 'Chest', equipment: 'Bodyweight' },
    { name: 'Squat', category: 'Legs', equipment: 'Barbell' },
    { name: 'Romanian Deadlift', category: 'Legs', equipment: 'Barbell' },
    { name: 'Leg Press', category: 'Legs', equipment: 'Machine' },
    { name: 'Leg Curl', category: 'Legs', equipment: 'Machine' },
    { name: 'Calf Raise', category: 'Legs', equipment: 'Machine' },
    { name: 'Deadlift', category: 'Back', equipment: 'Barbell' },
    { name: 'Barbell Row', category: 'Back', equipment: 'Barbell' },
    { name: 'Lat Pulldown', category: 'Back', equipment: 'Cable' },
    { name: 'Pull-up', category: 'Back', equipment: 'Bodyweight' },
    { name: 'Chin-up', category: 'Back', equipment: 'Bodyweight' },
    { name: 'Overhead Press', category: 'Shoulders', equipment: 'Barbell' },
    { name: 'Dumbbell Shoulder Press', category: 'Shoulders', equipment: 'Dumbbell' },
    { name: 'Face Pull', category: 'Shoulders', equipment: 'Cable' },
    { name: 'Dumbbell Curl', category: 'Arms', equipment: 'Dumbbell' },
    { name: 'Tricep Pushdown', category: 'Arms', equipment: 'Cable' },
    { name: 'Plank', category: 'Core', equipment: 'Bodyweight' }
  ]
};

App.ensureSeed = async function () {
  const settings = await App.db.get('settings', 'app');
  if (settings && settings.seeded) return;

  for (const ex of App.seed.exercises) {
    await App.db.put('exercises', {
      id: App.utils.uuid(),
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      archived: false,
      createdAt: App.utils.nowISO()
    });
  }

  await App.db.put('settings', {
    id: 'app',
    unit: (settings && settings.unit) || 'lb',
    seeded: true,
    createdAt: App.utils.nowISO()
  });
};
