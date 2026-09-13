window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.more = async function (container) {
    const settings = await App.queries.getSettings();
    const exercises = (await App.queries.getExercises()).sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="view-header"><h1>More</h1></div>

      <div class="section">
        <h2>Units</h2>
        <div class="segmented" id="unit-toggle">
          <button class="segmented-btn ${settings.unit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
          <button class="segmented-btn ${settings.unit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        </div>
      </div>

      <div class="section">
        <h2>Bodyweight</h2>
        <div class="modal-form" style="max-width:220px">
          <input type="number" inputmode="decimal" id="bodyweight-input" step="0.1" value="${settings.bodyweight != null ? settings.bodyweight : ''}" placeholder="e.g. 175">
        </div>
        <p class="section-note">Current value only — not a tracking history yet.</p>
      </div>

      <div class="section">
        <h2>Exercises</h2>
        <div id="exercise-list">
          ${exercises.map(e => `
            <div class="list-row">
              <div class="list-row-title">${App.utils.escapeHtml(e.name)}</div>
              <button class="list-row-action danger" data-archive="${e.id}">Archive</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-secondary" id="add-exercise-btn" style="margin-top:12px">+ Add Exercise</button>
      </div>

      <div class="section">
        <h2>Data</h2>
        <p class="section-note">Everything is stored locally on this device only. Back up regularly.</p>
        <button class="btn-secondary" id="export-btn">Export Data</button>
        <button class="btn-secondary" id="import-btn">Import Data</button>
        <input type="file" id="import-file" accept="application/json" hidden>
        <button class="btn-danger" id="clear-btn">Clear All Data</button>
        <div id="import-errors"></div>
      </div>
    `;

    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await App.commands.setUnit(btn.dataset.unit);
        App.views.more(container);
      });
    });

    const bwInput = container.querySelector('#bodyweight-input');
    bwInput.addEventListener('change', async () => {
      const value = bwInput.value !== '' ? parseFloat(bwInput.value) : null;
      await App.commands.setBodyweight(value);
    });

    container.querySelectorAll('[data-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archive this exercise? Past workouts using it are unaffected — it just won\'t appear when adding new exercises.')) return;
        await App.commands.archiveExercise(btn.dataset.archive);
        App.views.more(container);
      });
    });

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      const name = prompt('Exercise name');
      if (!name) return;
      App.commands.createExercise(name).then(() => App.views.more(container));
    });

    container.querySelector('#export-btn').addEventListener('click', async () => {
      const data = await App.db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fitlog-backup-' + App.utils.todayLocalISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const fileInput = container.querySelector('#import-file');
    const errorsEl = container.querySelector('#import-errors');
    container.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      errorsEl.innerHTML = '';
      const file = fileInput.files[0];
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (e) {
        errorsEl.innerHTML = '<p class="section-note">That file is not valid JSON.</p>';
        return;
      }
      const replace = confirm('Import and replace all existing data?\n\nOK = replace everything\nCancel = merge with existing data');
      try {
        await App.db.importAll(data, replace ? 'replace' : 'merge');
        alert('Import complete.');
        App.views.more(container);
      } catch (err) {
        const details = (err.details || []).slice(0, 6).map(d => `<div>${d}</div>`).join('');
        errorsEl.innerHTML = `<p class="section-note">Import rejected — nothing was changed.${details}</p>`;
      }
    });

    container.querySelector('#clear-btn').addEventListener('click', async () => {
      if (!confirm('Delete ALL data on this device? This cannot be undone. Export a backup first if you want to keep anything.')) return;
      await App.db.clearAll();
      await App.ensureSeed();
      alert('All data cleared.');
      App.views.more(container);
    });
  };
})();
