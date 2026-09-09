window.App = window.App || {};

App.quickLog = (function () {
  function open() {
    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Log</h2>
            <button class="modal-close">×</button>
          </div>
          <div class="quicklog-options">
            <button class="quicklog-option" data-type="bodyweight">Bodyweight</button>
            <button class="quicklog-option" data-type="nutrition">Nutrition</button>
            <button class="quicklog-option" data-type="sleep">Sleep</button>
            <button class="quicklog-option" data-type="measurement">Measurement</button>
            <button class="quicklog-option" data-type="note">Note</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.quicklog-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.remove();
        openForm(btn.dataset.type);
      });
    });
  }

  async function openForm(type) {
    const settings = await App.db.get('settings', 'app');
    const unit = (settings && settings.unit) || 'lb';
    const today = App.utils.todayLocalISO();
    const existingNutrition = type === 'nutrition' ? await App.queries.getNutritionForDate(today) : null;

    const forms = {
      bodyweight: `<label>Weight (${unit})<input type="number" inputmode="decimal" id="qf-weight" step="0.1"></label>`,
      nutrition: `
        ${existingNutrition ? '<p class="section-note">Already logged today — leave a field blank to keep its current value.</p>' : ''}
        <label>Calories<input type="number" inputmode="numeric" id="qf-calories" value="${existingNutrition ? existingNutrition.calories : ''}"></label>
        <label>Protein (g)<input type="number" inputmode="numeric" id="qf-protein" value="${existingNutrition ? existingNutrition.protein : ''}"></label>
        <label>Carbs (g)<input type="number" inputmode="numeric" id="qf-carbs" value="${existingNutrition ? existingNutrition.carbs : ''}"></label>
        <label>Fat (g)<input type="number" inputmode="numeric" id="qf-fat" value="${existingNutrition ? existingNutrition.fat : ''}"></label>
      `,
      sleep: `<label>Hours slept<input type="number" inputmode="decimal" id="qf-hours" step="0.1"></label>`,
      measurement: `
        <label>Type<input type="text" id="qf-mtype" placeholder="Waist, arm, etc."></label>
        <label>Value<input type="number" inputmode="decimal" id="qf-mvalue"></label>
      `,
      note: `<label>Note<textarea id="qf-note" rows="4"></textarea></label>`
    };
    const titles = {
      bodyweight: 'Log Bodyweight',
      nutrition: 'Log Nutrition',
      sleep: 'Log Sleep',
      measurement: 'Log Measurement',
      note: 'Add Note'
    };

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${titles[type]}</h2>
            <button class="modal-close">×</button>
          </div>
          <form class="quicklog-form" id="qf-form">
            ${forms[type]}
            <button type="submit" class="btn-primary">Save</button>
          </form>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const firstInput = overlay.querySelector('input, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    overlay.querySelector('#qf-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      if (type === 'bodyweight') {
        const weight = parseFloat(overlay.querySelector('#qf-weight').value);
        if (!weight) return;
        await App.commands.addBodyweight(today, weight);
      } else if (type === 'nutrition') {
        const fields = {};
        [['qf-calories', 'calories'], ['qf-protein', 'protein'], ['qf-carbs', 'carbs'], ['qf-fat', 'fat']].forEach(([id, key]) => {
          const raw = overlay.querySelector('#' + id).value;
          if (raw !== '') fields[key] = parseFloat(raw) || 0;
        });
        await App.commands.upsertNutritionForDate(today, fields);
      } else if (type === 'sleep') {
        const hours = parseFloat(overlay.querySelector('#qf-hours').value);
        if (!hours) return;
        await App.commands.addSleep(today, Math.round(hours * 60));
      } else if (type === 'measurement') {
        await App.commands.addMeasurement(
          today,
          overlay.querySelector('#qf-mtype').value || 'Custom',
          parseFloat(overlay.querySelector('#qf-mvalue').value) || 0
        );
      } else if (type === 'note') {
        await App.commands.addNote(today, overlay.querySelector('#qf-note').value || '');
      }

      overlay.remove();
      App.router.render();
    });
  }

  return { open };
})();
