window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.more = async function (container) {
    const settings = (await App.db.get('settings', 'app')) || { id: 'app', unit: 'lb' };
    const exercises = (await App.db.getAll('exercises'))
      .filter(e => !e.archived)
      .sort((a, b) => a.name.localeCompare(b.name));

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
        <h2>Your data</h2>
        <p class="section-note">Everything is stored locally on this device only. Back up regularly.</p>
        <button class="list-card" id="export-btn">
          <div class="list-card-title">Export Data</div>
          <div class="list-card-sub">Download a JSON backup</div>
        </button>
        <button class="list-card" id="import-btn">
          <div class="list-card-title">Import Data</div>
          <div class="list-card-sub">Restore from a JSON backup</div>
        </button>
        <input type="file" id="import-file" accept="application/json" hidden>
      </div>

      <div class="section">
        <h2>Exercise library</h2>
        <div id="exercise-list">
          ${exercises.map(e => `
            <div class="history-row">
              <div class="history-date">${e.name}</div>
              <div class="history-detail">${e.category}</div>
            </div>
          `).join('')}
        </div>
        <button class="btn-secondary" id="add-exercise-btn" style="margin-top: 12px">+ Add Exercise</button>
      </div>
    `;

    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        settings.unit = btn.dataset.unit;
        await App.db.put('settings', settings);
        App.views.more(container);
      });
    });

    container.querySelector('#export-btn').addEventListener('click', async () => {
      const data = await App.db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fitlog-backup-' + App.utils.todayISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const fileInput = container.querySelector('#import-file');
    container.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        alert('That file is not valid JSON.');
        return;
      }
      const replace = confirm('Import and replace all existing data?\n\nOK = replace everything\nCancel = merge with existing data');
      await App.db.importAll(data, replace ? 'replace' : 'merge');
      alert('Import complete.');
      App.views.more(container);
    });

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      const name = prompt('Exercise name');
      if (!name) return;
      const category = prompt('Category (e.g. Chest, Back, Legs)') || 'Other';
      App.db.put('exercises', {
        id: App.utils.uuid(),
        name,
        category,
        equipment: '',
        archived: false,
        createdAt: App.utils.nowISO()
      }).then(() => App.views.more(container));
    });
  };
})();
