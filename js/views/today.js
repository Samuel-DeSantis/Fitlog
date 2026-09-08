window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.today = async function (container) {
    const [bwLogs, nutritionLogs, sleepLogs, workouts, sets, settings] = await Promise.all([
      App.db.getAll('bodyweightLogs'),
      App.db.getAll('nutritionLogs'),
      App.db.getAll('sleepLogs'),
      App.db.getAll('workouts'),
      App.db.getAll('sets'),
      App.db.get('settings', 'app')
    ]);

    const unit = (settings && settings.unit) || 'lb';
    const today = App.utils.todayISO();

    bwLogs.sort((a, b) => a.date.localeCompare(b.date));
    const latestBW = bwLogs[bwLogs.length - 1];
    const weekAgo = App.utils.daysAgoISO(7);
    const bwWeekAgo = [...bwLogs].reverse().find(l => l.date <= weekAgo);
    const bwDelta = (latestBW && bwWeekAgo) ? Math.round((latestBW.weight - bwWeekAgo.weight) * 10) / 10 : null;
    const bwSpark = App.utils.sparklinePath(bwLogs.slice(-14).map(l => l.weight), 120, 40);

    const todaysNutrition = nutritionLogs.filter(n => n.date === today);
    const nutritionTotals = todaysNutrition.reduce((acc, n) => {
      acc.calories += n.calories || 0;
      acc.protein += n.protein || 0;
      return acc;
    }, { calories: 0, protein: 0 });

    const sleepSorted = [...sleepLogs].sort((a, b) => b.date.localeCompare(a.date));
    const todaysSleep = sleepSorted.find(s => s.date === today) || sleepSorted[0];

    const todaysWorkout = workouts.find(w => w.date === today && w.endedAt);
    let workoutSetCount = 0, workoutExCount = 0;
    if (todaysWorkout) {
      const wSets = sets.filter(s => s.workoutId === todaysWorkout.id);
      workoutSetCount = wSets.length;
      workoutExCount = new Set(wSets.map(s => s.exerciseId)).size;
    }
    const hasActiveWorkout = workouts.some(w => !w.endedAt);

    const last7 = App.utils.daysAgoISO(7);
    const workoutsThisWeek = workouts.filter(w => w.date >= last7 && w.endedAt).length;
    const nutritionThisWeek = nutritionLogs.filter(n => n.date >= last7);
    const avgProtein = nutritionThisWeek.length
      ? Math.round(nutritionThisWeek.reduce((a, n) => a + (n.protein || 0), 0) / nutritionThisWeek.length)
      : null;
    const sleepThisWeek = sleepLogs.filter(s => s.date >= last7);
    const avgSleepMin = sleepThisWeek.length
      ? Math.round(sleepThisWeek.reduce((a, s) => a + (s.durationMin || 0), 0) / sleepThisWeek.length)
      : null;

    function fmtSleep(min) {
      if (min == null) return '—';
      const h = Math.floor(min / 60), m = min % 60;
      return h + 'h ' + m + 'm';
    }

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
          <div class="metric-value">${Math.round(nutritionTotals.protein) || 0} g</div>
          <div class="metric-delta muted">${Math.round(nutritionTotals.calories) || 0} kcal logged today</div>
        </div>

        <div class="metric-card">
          <div class="metric-label">Sleep</div>
          <div class="metric-value">${todaysSleep ? fmtSleep(todaysSleep.durationMin) : '—'}</div>
          <div class="metric-delta muted">${todaysSleep ? App.utils.formatDateLabel(todaysSleep.date) : 'Not logged'}</div>
        </div>
      </div>

      <div class="workout-card">
        ${todaysWorkout ? `
          <div class="metric-label">Workout</div>
          <div class="metric-value" style="font-size:18px">${todaysWorkout.title || 'Workout'}</div>
          <div class="metric-delta muted">${workoutExCount} exercises · ${workoutSetCount} sets</div>
        ` : `
          <div class="metric-label">Workout</div>
          <div class="metric-delta muted">${hasActiveWorkout ? 'In progress' : 'Nothing logged today'}</div>
        `}
        <button class="btn-primary" id="start-workout-btn">${hasActiveWorkout ? 'Continue Workout' : (todaysWorkout ? 'Log Another' : 'Start Workout')}</button>
      </div>

      <div class="section">
        <h2>This week</h2>
        <div class="stat-row">
          <div class="stat"><span class="stat-value">${workoutsThisWeek}</span><span class="stat-label">Workouts</span></div>
          <div class="stat"><span class="stat-value">${avgProtein != null ? avgProtein : '—'}</span><span class="stat-label">Avg protein (g)</span></div>
          <div class="stat"><span class="stat-value">${fmtSleep(avgSleepMin)}</span><span class="stat-label">Avg sleep</span></div>
        </div>
      </div>
    `;

    container.querySelector('#start-workout-btn').addEventListener('click', () => App.router.go('/train'));
    container.querySelectorAll('[data-nav]').forEach((elx) => {
      elx.addEventListener('click', () => App.router.go(elx.dataset.nav));
    });
  };
})();
