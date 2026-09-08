window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.progress = async function (container, parts) {
    if (parts[0] === 'exercise' && parts[1]) {
      return renderExerciseDetail(container, parts[1]);
    }
    if (parts[0] === 'bodyweight') {
      return renderBodyweightDetail(container);
    }
    return renderList(container);
  };

  async function renderList(container) {
    const [exercises, sets, workouts, bwLogs] = await Promise.all([
      App.db.getAll('exercises'),
      App.db.getAll('sets'),
      App.db.getAll('workouts'),
      App.db.getAll('bodyweightLogs')
    ]);
    const wMap = Object.fromEntries(workouts.map(w => [w.id, w]));
    const byExercise = {};
    sets.forEach((s) => {
      const w = wMap[s.workoutId];
      if (!w || !w.endedAt) return;
      (byExercise[s.exerciseId] = byExercise[s.exerciseId] || []).push({ ...s, date: w.date });
    });

    const rows = Object.keys(byExercise).map((exId) => {
      const ex = exercises.find(e => e.id === exId);
      if (!ex) return null;
      const list = byExercise[exId].sort((a, b) => a.date.localeCompare(b.date));
      const last = list[list.length - 1];
      const best1RM = Math.max(...list.map(s => App.utils.estimate1RM(s.weight, s.reps)));
      const eightWeeksAgo = App.utils.daysAgoISO(56);
      const oldEntry = list.find(s => s.date >= eightWeeksAgo);
      const old1RM = oldEntry ? App.utils.estimate1RM(oldEntry.weight, oldEntry.reps) : null;
      const pctChange = (old1RM && old1RM > 0) ? Math.round(((best1RM - old1RM) / old1RM) * 100) : null;
      return { ex, last, best1RM, pctChange };
    }).filter(Boolean).sort((a, b) => b.last.date.localeCompare(a.last.date));

    bwLogs.sort((a, b) => a.date.localeCompare(b.date));
    const bwSpark = App.utils.sparklinePath(bwLogs.slice(-30).map(l => l.weight), 280, 60);

    container.innerHTML = `
      <div class="view-header"><h1>Progress</h1></div>
      <div class="section">
        <button class="progress-card" id="bw-card">
          <div class="progress-card-title">Bodyweight</div>
          ${bwSpark ? `<svg class="sparkline-lg" viewBox="0 0 280 60"><path d="${bwSpark}"/></svg>` : '<p class="empty-hint">No entries yet</p>'}
        </button>
      </div>
      <div class="section">
        <h2>Exercises</h2>
        ${rows.length ? rows.map(r => `
          <button class="progress-row" data-id="${r.ex.id}">
            <div>
              <div class="progress-row-title">${r.ex.name}</div>
              <div class="progress-row-sub">${r.last.weight}×${r.last.reps} · last ${App.utils.formatDateLabel(r.last.date)}</div>
            </div>
            <div class="progress-row-right">
              <div class="progress-row-value">~${r.best1RM} 1RM</div>
              ${r.pctChange != null ? `<div class="progress-row-delta">${r.pctChange >= 0 ? '+' : ''}${r.pctChange}%</div>` : ''}
            </div>
          </button>
        `).join('') : '<p class="empty-hint">Finish a workout to see progress here.</p>'}
      </div>
    `;

    container.querySelector('#bw-card').addEventListener('click', () => App.router.go('/progress/bodyweight'));
    container.querySelectorAll('.progress-row').forEach((btn) => {
      btn.addEventListener('click', () => App.router.go('/progress/exercise/' + btn.dataset.id));
    });
  }

  async function renderExerciseDetail(container, exId) {
    const [ex, sets, workouts] = await Promise.all([
      App.db.get('exercises', exId),
      App.db.getAll('sets'),
      App.db.getAll('workouts')
    ]);
    const wMap = Object.fromEntries(workouts.map(w => [w.id, w]));
    const mySets = sets
      .filter(s => s.exerciseId === exId)
      .map(s => ({ ...s, date: wMap[s.workoutId] && wMap[s.workoutId].date }))
      .filter(s => s.date && wMap[s.workoutId].endedAt)
      .sort((a, b) => a.date.localeCompare(b.date));

    const best = mySets.reduce((acc, s) => {
      if (!acc) return s;
      if (s.weight > acc.weight || (s.weight === acc.weight && s.reps > acc.reps)) return s;
      return acc;
    }, null);
    const best1RM = mySets.length ? Math.max(...mySets.map(s => App.utils.estimate1RM(s.weight, s.reps))) : 0;

    const byDate1RM = {};
    mySets.forEach((s) => {
      const v = App.utils.estimate1RM(s.weight, s.reps);
      if (!byDate1RM[s.date] || v > byDate1RM[s.date]) byDate1RM[s.date] = v;
    });
    const dates = Object.keys(byDate1RM).sort();
    const spark = App.utils.sparklinePath(dates.map(d => byDate1RM[d]), 280, 70);

    const byWorkout = {};
    mySets.forEach((s) => { (byWorkout[s.workoutId] = byWorkout[s.workoutId] || []).push(s); });
    const recentWorkoutIds = Object.keys(byWorkout)
      .sort((a, b) => (wMap[b].date).localeCompare(wMap[a].date))
      .slice(0, 10);

    container.innerHTML = `
      <div class="view-header">
        <div>
          <button class="back-btn" id="back-btn">‹ Progress</button>
          <h1>${ex ? ex.name : 'Exercise'}</h1>
        </div>
      </div>
      <div class="section">
        <div class="metric-card">
          <div class="metric-label">Current best</div>
          <div class="metric-value">${best ? best.weight + '×' + best.reps : '—'}</div>
          <div class="metric-delta muted">Estimated 1RM ${best1RM ? '~' + best1RM : '—'}</div>
        </div>
        ${spark ? `<svg class="sparkline-lg" viewBox="0 0 280 70"><path d="${spark}"/></svg>` : ''}
      </div>
      <div class="section">
        <h2>Recent workouts</h2>
        ${recentWorkoutIds.length ? recentWorkoutIds.map((wid) => {
          const w = wMap[wid];
          const wSets = byWorkout[wid].sort((a, b) => a.setIndex - b.setIndex);
          return `
            <div class="history-row">
              <div class="history-date">${App.utils.formatDateLabel(w.date)}</div>
              <div class="history-detail">${wSets.map(s => s.weight + '×' + s.reps).join(', ')}</div>
            </div>
          `;
        }).join('') : '<p class="empty-hint">No history yet</p>'}
      </div>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => App.router.go('/progress'));
  }

  async function renderBodyweightDetail(container) {
    const settings = await App.db.get('settings', 'app');
    const unit = (settings && settings.unit) || 'lb';
    const logs = (await App.db.getAll('bodyweightLogs')).sort((a, b) => a.date.localeCompare(b.date));
    const spark = App.utils.sparklinePath(logs.map(l => l.weight), 280, 80);
    const latest = logs[logs.length - 1];
    const d7 = [...logs].reverse().find(l => l.date <= App.utils.daysAgoISO(7));
    const d30 = [...logs].reverse().find(l => l.date <= App.utils.daysAgoISO(30));

    container.innerHTML = `
      <div class="view-header">
        <div>
          <button class="back-btn" id="back-btn">‹ Progress</button>
          <h1>Bodyweight</h1>
        </div>
      </div>
      <div class="section">
        <div class="metric-card">
          <div class="metric-value">${latest ? latest.weight.toFixed(1) + ' ' + unit : '—'}</div>
          <div class="metric-delta muted">7d: ${latest && d7 ? Math.round((latest.weight - d7.weight) * 10) / 10 : '—'} · 30d: ${latest && d30 ? Math.round((latest.weight - d30.weight) * 10) / 10 : '—'}</div>
        </div>
        ${spark ? `<svg class="sparkline-lg" viewBox="0 0 280 80"><path d="${spark}"/></svg>` : '<p class="empty-hint">No entries yet</p>'}
      </div>
      <div class="section">
        <h2>Entries</h2>
        ${logs.length ? [...logs].reverse().map(l => `
          <div class="history-row">
            <div class="history-date">${App.utils.formatDateLabel(l.date)}</div>
            <div class="history-detail">${l.weight.toFixed(1)} ${unit}</div>
          </div>
        `).join('') : '<p class="empty-hint">No entries yet</p>'}
      </div>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => App.router.go('/progress'));
  }
})();
