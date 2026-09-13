window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.train = async function (container) {
    let activeWorkout, sessions;
    try {
      [activeWorkout, sessions] = await Promise.all([
        App.queries.getActiveWorkout(),
        App.queries.getSessions()
      ]);
    } catch (err) {
      if (err instanceof App.errors.MultipleActiveWorkoutsError) {
        container.innerHTML = `<div class="view-header"><h1>Train</h1></div>${App.ui.conflictPanelHtml(err)}`;
        App.ui.wireConflictPanel(container);
        return;
      }
      throw err;
    }

    let bannerHtml = '';
    if (activeWorkout) {
      bannerHtml = `
        <div class="active-banner">
          <div class="active-banner-label">Workout in progress</div>
          <div class="active-banner-title">${App.utils.escapeHtml(activeWorkout.title)}</div>
          <button class="btn-primary" id="resume-btn">Resume Workout</button>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="view-header"><h1>Train</h1></div>
      ${bannerHtml}
      <div class="section">
        <h2>Sessions</h2>
        ${sessions.length ? sessions.map(s => `
          <div class="list-row">
            <div>
              <div class="list-row-title"><span class="color-dot color-dot-filled" style="background:${App.sessionColors.hexFor(s.color)}"></span>${App.utils.escapeHtml(s.name)}</div>
              <div class="list-row-sub">${s.exercises.length} exercise${s.exercises.length === 1 ? '' : 's'}</div>
            </div>
            <div class="list-row-right">
              <button class="list-row-action" data-start="${s.id}">Start</button>
              <button class="list-row-action" data-modify="${s.id}">Modify</button>
              <button class="list-row-action danger" data-delete="${s.id}">Delete</button>
            </div>
          </div>
        `).join('') : '<p class="empty-hint">No sessions yet. Create one to reuse a workout structure.</p>'}
        <button class="btn-secondary" id="create-session-btn" style="margin-top:12px">+ Create Session</button>
      </div>
      <div class="section">
        <button class="btn-primary" id="new-workout-btn">+ New Workout</button>
      </div>
    `;

    const resumeBtn = container.querySelector('#resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', () => App.router.go('/workout/' + activeWorkout.id));

    container.querySelector('#new-workout-btn').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const workout = await App.commands.startWorkout('Workout', []);
      App.router.go('/workout/' + workout.id);
    });

    container.querySelector('#create-session-btn').addEventListener('click', () => openSessionEditor(null));

    container.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        const session = sessions.find(s => s.id === btn.dataset.start);
        const workout = await App.commands.startFromSession(session);
        App.router.go('/workout/' + workout.id);
      });
    });

    container.querySelectorAll('[data-modify]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const session = sessions.find(s => s.id === btn.dataset.modify);
        openSessionEditor(session);
      });
    });

    container.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this session? Past workouts started from it are unaffected.')) return;
        await App.commands.deleteSession(btn.dataset.delete);
        App.router.render();
      });
    });
  };

  async function openSessionEditor(existingSession) {
    const exercises = await App.queries.getExercises(true);
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    let name = existingSession ? existingSession.name : '';
    let orderedIds = existingSession ? [...existingSession.exercises] : [];
    let selectedColor = App.sessionColors.normalize(existingSession ? existingSession.color : null);

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${existingSession ? 'Modify Session' : 'Create Session'}</h2>
            <button class="modal-close">×</button>
          </div>
          <div class="modal-form">
            <label>Name<input type="text" id="session-name" value="${App.utils.escapeHtml(name)}" placeholder="Upper Body"></label>
            <label>Calendar color<div id="session-color-swatches" class="color-swatches"></div></label>
            <div id="session-exercise-list"></div>
            <button class="btn-secondary" id="session-add-exercise" type="button">+ Add Exercise</button>
            <button class="btn-primary" id="session-save" type="button">Save</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    function renderSwatches() {
      const el = overlay.querySelector('#session-color-swatches');
      el.innerHTML = App.sessionColors.PALETTE.map(c => `
        <button type="button" class="color-swatch ${c.key === selectedColor ? 'color-swatch-selected' : ''}"
          style="background:${c.hex}" data-color="${c.key}" aria-label="${c.label}"></button>
      `).join('');
      el.querySelectorAll('.color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedColor = btn.dataset.color;
          renderSwatches();
        });
      });
    }
    renderSwatches();

    function renderExerciseList() {
      const listEl = overlay.querySelector('#session-exercise-list');
      listEl.innerHTML = orderedIds.map((id, i) => {
        const ex = exerciseMap[id];
        if (!ex) return '';
        return `
          <div class="list-row" data-id="${id}">
            <div class="list-row-title">${i + 1}. ${App.utils.escapeHtml(ex.name)}</div>
            <div class="list-row-right">
              <button class="list-row-action" data-move-up="${id}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="list-row-action" data-move-down="${id}" ${i === orderedIds.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="list-row-action danger" data-remove="${id}">Remove</button>
            </div>
          </div>
        `;
      }).join('') || '<p class="empty-hint">No exercises yet.</p>';

      listEl.querySelectorAll('[data-move-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.moveUp;
          const i = orderedIds.indexOf(id);
          if (i > 0) { [orderedIds[i - 1], orderedIds[i]] = [orderedIds[i], orderedIds[i - 1]]; renderExerciseList(); }
        });
      });
      listEl.querySelectorAll('[data-move-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.moveDown;
          const i = orderedIds.indexOf(id);
          if (i < orderedIds.length - 1) { [orderedIds[i + 1], orderedIds[i]] = [orderedIds[i], orderedIds[i + 1]]; renderExerciseList(); }
        });
      });
      listEl.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          orderedIds = orderedIds.filter(id => id !== btn.dataset.remove);
          renderExerciseList();
        });
      });
    }
    renderExerciseList();

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#session-add-exercise').addEventListener('click', () => {
      App.ui.openExercisePicker(orderedIds, (ex) => {
        orderedIds.push(ex.id);
        renderExerciseList();
      });
    });

    overlay.querySelector('#session-save').addEventListener('click', async () => {
      const nameValue = overlay.querySelector('#session-name').value.trim();
      if (!nameValue) { alert('Give the session a name.'); return; }
      if (!orderedIds.length) { alert('Add at least one exercise.'); return; }
      if (existingSession) {
        await App.commands.updateSession(existingSession.id, { name: nameValue, exercises: orderedIds, color: selectedColor });
      } else {
        await App.commands.createSession(nameValue, orderedIds, selectedColor);
      }
      overlay.remove();
      App.router.render();
    });
  }
})();
