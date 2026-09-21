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
    // existingSession comes from queries.getSessions(), already
    // normalized to {exerciseId, targetSets, repMin, repMax} entries
    // (see prescriptions.js) — a pre-4.1 session's entries normalize to
    // null prescription fields, which render below as simply blank/
    // placeholder inputs, satisfying "existing Sessions without
    // prescriptions still render correctly" with no special-casing here.
    //
    // sessionExercises is the editor's single source of truth: one array
    // of self-contained {exerciseId, targetSets, repMin, repMax} objects.
    // Reordering swaps whole objects, and removing filters by
    // exerciseId — a prescription can never end up attached to the wrong
    // exercise via a stale array index, because there is no separate
    // parallel array to fall out of sync with. Cloned so editing here
    // never mutates the session object the Train list is still showing
    // behind this sheet until Save.
    let sessionExercises = existingSession ? existingSession.exercises.map(e => ({ ...e })) : [];
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

    // Digits only, live as the user types — no decimal point (sets/reps
    // are always whole numbers), same "sanitize the raw keystrokes"
    // approach the active-workout set-entry fields use for weight/reps.
    function sanitizeIntegerInput(raw) {
      return raw.replace(/[^0-9]/g, '');
    }

    function renderExerciseList() {
      const listEl = overlay.querySelector('#session-exercise-list');
      listEl.innerHTML = sessionExercises.map((entry, i) => {
        const ex = exerciseMap[entry.exerciseId];
        if (!ex) return '';
        return `
          <div class="session-exercise-row" data-id="${entry.exerciseId}">
            <div class="list-row-top">
              <div class="list-row-title">${i + 1}. ${App.utils.escapeHtml(ex.name)}</div>
              <div class="list-row-right">
                <button class="list-row-action" data-move-up="${entry.exerciseId}" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="list-row-action" data-move-down="${entry.exerciseId}" ${i === sessionExercises.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="list-row-action danger" data-remove="${entry.exerciseId}">Remove</button>
              </div>
            </div>
            <div class="prescription-row">
              <label class="prescription-field">
                <span class="prescription-unit">Sets</span>
                <input type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off"
                  class="prescription-input" data-field="targetSets" placeholder="3"
                  value="${entry.targetSets != null ? entry.targetSets : ''}" aria-label="Target sets">
              </label>
              <label class="prescription-field prescription-range">
                <span class="prescription-unit">Reps</span>
                <input type="text" inputmode="numeric" enterkeyhint="next" autocomplete="off"
                  class="prescription-input prescription-input-narrow" data-field="repMin" placeholder="8"
                  value="${entry.repMin != null ? entry.repMin : ''}" aria-label="Minimum reps">
                <span class="prescription-dash">–</span>
                <input type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off"
                  class="prescription-input prescription-input-narrow" data-field="repMax" placeholder="12"
                  value="${entry.repMax != null ? entry.repMax : ''}" aria-label="Maximum reps">
              </label>
            </div>
          </div>
        `;
      }).join('') || '<p class="empty-hint">No exercises yet.</p>';

      listEl.querySelectorAll('[data-move-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.moveUp;
          const i = sessionExercises.findIndex(e => e.exerciseId === id);
          if (i > 0) { [sessionExercises[i - 1], sessionExercises[i]] = [sessionExercises[i], sessionExercises[i - 1]]; renderExerciseList(); }
        });
      });
      listEl.querySelectorAll('[data-move-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.moveDown;
          const i = sessionExercises.findIndex(e => e.exerciseId === id);
          if (i < sessionExercises.length - 1) { [sessionExercises[i + 1], sessionExercises[i]] = [sessionExercises[i], sessionExercises[i + 1]]; renderExerciseList(); }
        });
      });
      listEl.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          sessionExercises = sessionExercises.filter(e => e.exerciseId !== btn.dataset.remove);
          renderExerciseList();
        });
      });

      // Live-bind every keystroke straight into sessionExercises (find by
      // the row's exerciseId, never by index) so the array is always the
      // current truth — Save just validates and persists it as-is.
      listEl.querySelectorAll('.prescription-input').forEach((input) => {
        input.addEventListener('focus', () => {
          try { input.select(); } catch (e) { /* selection unsupported here — not fatal */ }
        });
        input.addEventListener('input', () => {
          input.value = sanitizeIntegerInput(input.value);
          const exerciseId = input.closest('.session-exercise-row').dataset.id;
          const entry = sessionExercises.find(e => e.exerciseId === exerciseId);
          if (!entry) return;
          entry[input.dataset.field] = input.value === '' ? null : parseInt(input.value, 10);
        });
      });
    }
    renderExerciseList();

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#session-add-exercise').addEventListener('click', () => {
      App.ui.openExercisePicker(sessionExercises.map(e => e.exerciseId), (ex) => {
        // Phase 4.1's own default for an unprescribed exercise — null
        // fields, i.e. no target set yet. Shown as blank inputs with a
        // placeholder example (see renderExerciseList) rather than a
        // guessed real value, so nothing is saved unless the person
        // actually enters it.
        sessionExercises.push({ exerciseId: ex.id, targetSets: null, repMin: null, repMax: null });
        renderExerciseList();
      });
    });

    overlay.querySelector('#session-save').addEventListener('click', async () => {
      const nameValue = overlay.querySelector('#session-name').value.trim();
      if (!nameValue) { alert('Give the session a name.'); return; }
      if (!sessionExercises.length) { alert('Add at least one exercise.'); return; }

      // Reuse Phase 4.1's own validation (App.prescriptions.validate) as
      // the single source of truth for what's valid, rather than
      // re-implementing the rules here — this loop only adds pointing at
      // which exercise is the problem, since that command-layer error
      // message alone doesn't say which of several exercises it's about.
      for (const entry of sessionExercises) {
        try {
          App.prescriptions.validate(entry);
        } catch (err) {
          const ex = exerciseMap[entry.exerciseId];
          alert(`${ex ? ex.name : 'This exercise'}: ${err.message}`);
          return;
        }
      }

      if (existingSession) {
        await App.commands.updateSession(existingSession.id, { name: nameValue, exercises: sessionExercises, color: selectedColor });
      } else {
        await App.commands.createSession(nameValue, sessionExercises, selectedColor);
      }
      overlay.remove();
      App.router.render();
    });
  }
})();
