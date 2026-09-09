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
    const exercises = await App.queries.getExercises(true);
    const rows = [];

    for (const ex of exercises) {
      const history = await App.queries.getExerciseHistory(ex.id);
      if (!history.length) continue;
      const allSets = history.flatMap(h => h.sets);
      const best = App.analytics.bestRecordedSet(allSets);
      const best1RM = App.analytics.bestEstimated1RM(allSets);
      const cmp = App.analytics.periodComparison(history, 30, App.analytics.bestEstimated1RM);
      rows.push({ ex, lastDate: history[0].workout.date, best, best1RM, cmp });
    }

    rows.sort((a, b) => b.lastDate.localeCompare(a.lastDate));

    const bwLogs = await App.queries.getBodyweightForRange('0000-01-01', App.utils.todayLocalISO());
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
              <div class="progress-row-title">${r.ex.name}${r.ex.archived ? ' <span class="empty-hint" style="display:inline">(archived)</span>' : ''}</div>
              <div class="progress-row-sub">Best: ${r.best.weight}×${r.best.reps} · ${App.utils.formatDateLabel(r.lastDate)}</div>
            </div>
            <div class="progress-row-right">
              <div class="progress-row-value">~${r.best1RM} 1RM</div>
              ${r.cmp.hasComparison ? `<div class="progress-row-delta">${r.cmp.pctChange >= 0 ? '+' : ''}${r.cmp.pctChange}% / 30d</div>` : ''}
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
    const [ex, history] = await Promise.all([
      App.db.get('exercises', exId),
      App.queries.getExerciseHistory(exId)
    ]);
    const allSets = history.flatMap(h => h.sets);
    const best = App.analytics.bestRecordedSet(allSets);
    const best1RM = App.analytics.bestEstimated1RM(allSets);
    const cmp30 = App.analytics.periodComparison(history, 30, App.analytics.bestEstimated1RM);

    const byDate1RM = {};
    history.forEach(({ workout, sets }) => {
      const v = App.analytics.bestEstimated1RM(sets);
      if (!byDate1RM[workout.date] || v > byDate1RM[workout.date]) byDate1RM[workout.date] = v;
    });
    const dates = Object.keys(byDate1RM).sort();
    const spark = App.utils.sparklinePath(dates.map(d => byDate1RM[d]), 280, 70);

    const recent = history.slice(0, 10);

    container.innerHTML = `
      <div class="view-header">
        <div>
          <button class="back-btn" id="back-btn">‹ Progress</button>
          <h1>${ex ? ex.name : 'Exercise'}</h1>
        </div>
      </div>
      <div class="section">
        <div class="metric-card">
          <div class="metric-label">Best recorded</div>
          <div class="metric-value">${best ? best.weight + '×' + best.reps : '—'}</div>
          <div class="metric-delta muted">Estimated 1RM ${best1RM ? '~' + best1RM : '—'}${cmp30.hasComparison ? ` · ${cmp30.pctChange >= 0 ? '+' : ''}${cmp30.pctChange}% vs. prior 30 days` : ''}</div>
        </div>
        ${spark ? `<svg class="sparkline-lg" viewBox="0 0 280 70"><path d="${spark}"/></svg>` : ''}
      </div>
      <div class="section">
        <h2>Recent workouts</h2>
        ${recent.length ? recent.map(({ workout, sets }) => `
          <div class="history-row">
            <div class="history-date">${App.utils.formatDateLabel(workout.date)}</div>
            <div class="history-detail">${sets.map(s => s.weight + '×' + s.reps).join(', ')}</div>
          </div>
        `).join('') : '<p class="empty-hint">No history yet</p>'}
      </div>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => App.router.go('/progress'));
  }

  async function renderBodyweightDetail(container) {
    const settings = await App.db.get('settings', 'app');
    const unit = (settings && settings.unit) || 'lb';
    const logs = (await App.queries.getBodyweightForRange('0000-01-01', App.utils.todayLocalISO()))
      .sort((a, b) => a.date.localeCompare(b.date));
    const spark = App.utils.sparklinePath(logs.map(l => l.weight), 280, 80);
    const latest = logs[logs.length - 1];
    const d7 = await App.queries.getBodyweightOnOrBefore(App.utils.daysAgoISO(7));
    const d30 = await App.queries.getBodyweightOnOrBefore(App.utils.daysAgoISO(30));

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
          <div class="metric-delta muted">7d: ${latest && d7 && d7.id !== latest.id ? Math.round((latest.weight - d7.weight) * 10) / 10 : '—'} · 30d: ${latest && d30 && d30.id !== latest.id ? Math.round((latest.weight - d30.weight) * 10) / 10 : '—'}</div>
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
