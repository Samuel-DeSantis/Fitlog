window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.today = async function (container) {
    const today = App.utils.todayLocalISO();
    const settings = await App.db.get('settings', 'app');
    const unit = (settings && settings.unit) || 'lb';

    const [latestBW, todaysNutrition, todaysSleep, latestSleep, activeWorkout, todaysWorkouts, weekWorkouts, weekNutrition, weekSleep] = await Promise.all([
      App.queries.getLatestBodyweight(),
      App.queries.getNutritionForDate(today),
      App.queries.getSleepForDate(today),
      App.queries.getLatestSleep(),
      App.queries.getActiveWorkout(),
      App.queries.getWorkoutsInRange(today, today),
      App.queries.getWorkoutsInRange(App.utils.daysAgoISO(7), today),
      App.queries.getNutritionForRange(App.utils.daysAgoISO(7), today),
      App.queries.getSleepForRange(App.utils.daysAgoISO(7), today)
    ]);

    const bwWeekAgo = await App.queries.getBodyweightOnOrBefore(App.utils.daysAgoISO(7));
    const bwDelta = (latestBW && bwWeekAgo && bwWeekAgo.id !== latestBW.id)
      ? Math.round((latestBW.weight - bwWeekAgo.weight) * 10) / 10 : null;

    const bwRange = await App.queries.getBodyweightForRange(App.utils.daysAgoISO(14), today);
    bwRange.sort((a, b) => a.date.localeCompare(b.date));
    const bwSpark = App.utils.sparklinePath(bwRange.map(l => l.weight), 120, 40);

    const todaysWorkout = todaysWorkouts[0];
    const extraTodaysWorkouts = todaysWorkouts.length - 1;
    let workoutExCount = 0, workoutSetCount = 0;
    for (const w of todaysWorkouts) {
      const [wExercises, wSets] = await Promise.all([
        App.queries.getWorkoutExercises(w.id),
        App.queries.getSetsForWorkout(w.id)
      ]);
      workoutExCount += wExercises.length;
      workoutSetCount += wSets.filter(App.commands.isSetCompleted).length;
    }

    const activeIsFromToday = activeWorkout && activeWorkout.date === today;

    const avgProtein = weekNutrition.length
      ? Math.round(weekNutrition.reduce((a, n) => a + (n.protein || 0), 0) / weekNutrition.length)
      : null;
    const avgSleepMin = weekSleep.length
      ? Math.round(weekSleep.reduce((a, s) => a + (s.durationMin || 0), 0) / weekSleep.length)
      : null;

    function fmtSleep(min) {
      if (min == null) return null;
      const h = Math.floor(min / 60), m = min % 60;
      return h + 'h ' + m + 'm';
    }

    const sleepDisplay = todaysSleep
      ? fmtSleep(todaysSleep.durationMin)
      : null;
    const sleepFallbackNote = (!todaysSleep && latestSleep)
      ? `Last logged ${App.utils.formatDateLabel(latestSleep.date)}: ${fmtSleep(latestSleep.durationMin)}`
      : null;

    container.innerHTML = `
      <div class="view-header">
        <div>
          <h1>Today</h1>
          <p class="view-subhead">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      <div class="card-grid">
        <div class="metric-card" data-nav="/progress/bodyweight">
          <div class="metric-label">Bodyweight</div>
          <div class="metric-value">${latestBW ? latestBW.weight.toFixed(1) + ' ' + unit : '—'}</div>
          ${bwDelta != null
            ? `<div class="metric-delta">${bwDelta > 0 ? '↑' : bwDelta < 0 ? '↓' : '–'} ${Math.abs(bwDelta)} ${unit} this week</div>`
            : `<div class="metric-delta muted">Log a weigh-in to see a trend</div>`}
          ${bwSpark ? `<svg class="sparkline" viewBox="0 0 120 40"><path d="${bwSpark}"/></svg>` : ''}
        </div>

        <div class="metric-card">
          <div class="metric-label">Protein</div>
          <div class="metric-value">${todaysNutrition ? Math.round(todaysNutrition.protein || 0) + ' g' : 'Not logged'}</div>
          <div class="metric-delta muted">${todaysNutrition ? Math.round(todaysNutrition.calories || 0) + ' kcal today' : ' '}</div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Sleep</div>
          <div class="metric-value">${sleepDisplay || 'Not logged'}</div>
          ${sleepFallbackNote ? `<div class="metric-delta muted">${sleepFallbackNote}</div>` : ''}
        </div>
      </div>

      <div class="workout-card">
        ${todaysWorkout ? `
          <div class="metric-label">Workout</div>
          <div class="metric-value" style="font-size:18px">${extraTodaysWorkouts > 0 ? `${todaysWorkouts.length} workouts today` : (todaysWorkout.title || 'Workout')}</div>
          <div class="metric-delta muted">${workoutExCount} exercises · ${workoutSetCount} sets completed</div>
        ` : `
          <div class="metric-label">Workout</div>
          <div class="metric-delta muted">${activeWorkout ? (activeIsFromToday ? 'In progress' : `In progress — started ${App.utils.formatDateLabel(activeWorkout.date)}`) : 'Nothing logged today'}</div>
        `}
        <button class="btn-primary" id="start-workout-btn">${activeWorkout ? 'Continue Workout' : (todaysWorkout ? 'Log Another' : 'Start Workout')}</button>
      </div>

      <div class="section">
        <h2>This week</h2>
        <div class="stat-row">
          <div class="stat"><span class="stat-value">${weekWorkouts.length}</span><span class="stat-label">Workouts</span></div>
          <div class="stat"><span class="stat-value">${avgProtein != null ? avgProtein : '—'}</span><span class="stat-label">Avg protein (g)</span></div>
          <div class="stat"><span class="stat-value">${fmtSleep(avgSleepMin) || '—'}</span><span class="stat-label">Avg sleep</span></div>
        </div>
      </div>
    `;

    container.querySelector('#start-workout-btn').addEventListener('click', () => App.router.go('/train'));
    container.querySelectorAll('[data-nav]').forEach((elx) => {
      elx.addEventListener('click', () => App.router.go(elx.dataset.nav));
    });
  };
})();
