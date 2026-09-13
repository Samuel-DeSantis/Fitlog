window.App = window.App || {};

App.ensureSeed = async function () {
  const settings = await App.db.get('settings', 'app');
  if (settings && settings.seeded) return;

  for (const ex of App.exerciseSeedData) {
    await App.commands.createExercise(ex.name, ex);
  }

  const base = settings || { id: 'app', unit: 'lb', bodyweight: null };
  base.seeded = true;
  await App.db.put('settings', base);
};
