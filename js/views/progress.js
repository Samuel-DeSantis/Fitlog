window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.progress = async function (container) {
    const exercises = await App.progress.getExercisesWithHistory();

    if (!exercises.length) {
      container.innerHTML = `
        <div class="view-header"><h1>Progress</h1></div>
        <p class="empty-hint">Complete a workout to start seeing your progress here.</p>
        <button class="btn-primary" id="progress-log-workout-btn">+ Log Workout</button>
      `;
      container.querySelector('#progress-log-workout-btn').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        const workout = await App.commands.startWorkout('Workout', []);
        App.router.go('/workout/' + workout.id);
      });
      return;
    }

    // Simplest possible default: alphabetically first. The selector
    // makes switching trivial, so there's no need for a "smarter"
    // (e.g. most-recently-trained) default in this first pass.
    const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="view-header"><h1>Progress</h1></div>
      <div class="progress-selector">
        <label for="progress-exercise-select" class="progress-selector-label">Exercise</label>
        <div class="progress-select-wrap">
          <select id="progress-exercise-select" class="progress-select">
            ${sorted.map(e => `<option value="${e.id}">${App.utils.escapeHtml(e.name)}</option>`).join('')}
          </select>
          <span class="progress-select-arrow" aria-hidden="true">▼</span>
        </div>
      </div>
      <div id="progress-exercise-section"></div>
    `;

    const select = container.querySelector('#progress-exercise-select');
    const section = container.querySelector('#progress-exercise-section');

    async function renderExerciseSection(exerciseId) {
      const summary = await App.progress.getExerciseSummary(exerciseId);
      section.innerHTML = await exerciseSectionHtml(summary);
      wireExerciseSection(section);
    }

    select.addEventListener('change', () => renderExerciseSection(select.value));
    await renderExerciseSection(select.value);
  };

  async function exerciseSectionHtml(summary) {
    if (!summary.hasHistory) {
      // Defensive only — the selector only ever lists exercises that
      // already have history, so this shouldn't normally be reachable.
      return `<p class="empty-hint">No completed sets for this exercise yet.</p>`;
    }

    const weightSeries = summary.chartSeries.map(p => ({ date: p.date, value: p.bestWeight }));
    const volumeSeries = summary.chartSeries.map(p => ({ date: p.date, value: p.volume }));

    const historyRows = summary.history.map(({ workout, sets }) => `
      <button class="progress-history-row" data-view-workout="${workout.id}">
        <span class="progress-history-date">${App.utils.formatDateLabel(workout.date)}</span>
        <span class="progress-history-sets">${App.utils.escapeHtml(App.progress.formatHistoryLine(sets))}</span>
      </button>
    `).join('');

    return `
      <div class="section">
        <h2>Summary</h2>
        <div class="progress-summary-grid">
          <div class="progress-stat">
            <div class="progress-stat-value">${summary.bestWeight}</div>
            <div class="progress-stat-label">Best Weight</div>
          </div>
          <div class="progress-stat">
            <div class="progress-stat-value">${summary.bestReps}</div>
            <div class="progress-stat-label">Best Reps</div>
          </div>
          <div class="progress-stat">
            <div class="progress-stat-value">${summary.totalVolume.toLocaleString()}</div>
            <div class="progress-stat-label">Total Volume</div>
          </div>
        </div>
      </div>
      <div class="section">
        <h2>Best Weight Over Time</h2>
        <p class="section-note">Weight (lb) · Workout date/history</p>
        ${chartHtml(weightSeries)}
      </div>
      <div class="section">
        <h2>Volume Over Time</h2>
        <p class="section-note">Volume (lb × reps) · Workout date/history</p>
        ${chartHtml(volumeSeries)}
      </div>
      <div class="section">
        <h2>History</h2>
        <div class="progress-history-list">${historyRows}</div>
      </div>
    `;
  }

  function wireExerciseSection(section) {
    section.querySelectorAll('[data-view-workout]').forEach((btn) => {
      btn.addEventListener('click', () => App.router.go('/workout/' + btn.dataset.viewWorkout));
    });
  }

  // A deliberately simple V1 line chart: no library (none exists in this
  // project), no axes/gridlines, just a line + dots so a trend is
  // visible at a glance. Handles the no-data, one-point, and
  // all-identical-values cases explicitly rather than letting any of
  // them divide by zero or draw something meaningless.
  function chartHtml(points) {
    const width = 320;
    const height = 120;
    const padding = 20;

    if (!points.length) {
      return `<p class="progress-chart-empty">Not enough data yet</p>`;
    }

    if (points.length === 1) {
      const cx = width / 2;
      const cy = height / 2;
      return `
        <svg viewBox="0 0 ${width} ${height}" class="progress-chart-svg" role="img" aria-label="One data point">
          <circle cx="${cx}" cy="${cy}" r="4" class="progress-chart-dot"></circle>
          <text x="${cx}" y="${cy - 14}" text-anchor="middle" class="progress-chart-point-label">${points[0].value.toLocaleString()}</text>
        </svg>
        <p class="progress-chart-caption">${App.utils.formatDateLabel(points[0].date)}</p>
      `;
    }

    const values = points.map(p => p.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1; // every value identical — keep a flat but valid line rather than dividing by zero
    const stepX = (width - padding * 2) / (points.length - 1);

    const coords = points.map((p, i) => {
      const x = padding + i * stepX;
      const y = height - padding - ((p.value - minV) / range) * (height - padding * 2);
      return [x, y];
    });

    const pathD = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dots = coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="progress-chart-dot"></circle>`).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" class="progress-chart-svg" role="img" aria-label="Trend chart">
        <path d="${pathD}" class="progress-chart-line"></path>
        ${dots}
      </svg>
      <p class="progress-chart-caption">${App.utils.formatDateLabel(points[0].date)} – ${App.utils.formatDateLabel(points[points.length - 1].date)}</p>
    `;
  }
})();
