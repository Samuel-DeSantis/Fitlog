window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.train = async function (container) {
    const active = await App.queries.getActiveWorkout();
    if (active) {
      await renderActiveWorkout(container, active);
    } else {
      await renderStart(container);
    }
  };

  async function renderStart(container) {
    const [last, templates] = await Promise.all([
      App.queries.getLatestCompletedWorkout(),
      App.queries.getTemplates()
    ]);

    container.innerHTML = `
      <div class="view-header"><h1>Train</h1></div>
      <div class="section">
        ${last ? `
          <button class="list-card" id="repeat-last">
            <div class="list-card-title">Repeat ${last.title || 'Last Workout'}</div>
            <div class="list-card-sub">Last done ${App.utils.formatDateLabel(last.date)} · structure only, no numbers copied</div>
          </button>
        ` : ''}
        ${templates.map(t => `
          <button class="list-card" data-template="${t.id}">
            <div class="list-card-title">Start ${t.name}</div>
            <div class="list-card-sub">${t.exercises.length} exercise${t.exercises.length === 1 ? '' : 's'}</div>
          </button>
        `).join('')}
        <button class="list-card" id="new-workout">
          <div class="list-card-title">New Workout</div>
          <div class="list-card-sub">Pick exercises from scratch</div>
        </button>
      </div>
    `;

    if (last) {
      container.querySelector('#repeat-last').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        await App.commands.repeatLastWorkout();
        App.router.render();
      });
    }
    container.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        const t = templates.find(tt => tt.id === btn.dataset.template);
        await App.commands.startFromTemplate(t);
        App.router.render();
      });
    });
    container.querySelector('#new-workout').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      await App.commands.startWorkout('Workout', []);
      App.router.render();
    });
  }

  async function renderActiveWorkout(container, workout) {
    const [exercises, workoutExercises] = await Promise.all([
      App.queries.getExercises(true),
      App.queries.getWorkoutExercises(workout.id)
    ]);
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    let blocksHtml = '';
    for (const we of workoutExercises) {
      const ex = exerciseMap[we.exerciseId];
      if (!ex) continue;
      const [mySets, prevSets] = await Promise.all([
        App.queries.getSetsForWorkoutExercise(we.id),
        App.queries.getPreviousPerformance(we.exerciseId, workout.id)
      ]);
      blocksHtml += exerciseBlockHtml(we, ex, prevSets, mySets);
    }

    container.innerHTML = `
      <div class="view-header">
        <div>
          <h1>${workout.title || 'Workout'}</h1>
          <p class="view-subhead">${App.utils.formatDateLabel(workout.date)}</p>
        </div>
      </div>
      <div id="exercise-blocks">${blocksHtml || '<p class="empty-hint">No exercises yet. Add one below to start logging.</p>'}</div>
      <button class="btn-secondary" id="add-exercise-btn">+ Add Exercise</button>
      <button class="btn-primary" id="finish-workout-btn">Finish Workout</button>
      <button class="btn-text" id="cancel-workout-btn">Cancel Workout</button>
    `;

    wireBlocks(container, workout);

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      openExercisePicker(async (ex) => {
        await App.commands.addExerciseToWorkout(workout.id, ex.id);
        App.router.render();
      });
    });

    container.querySelector('#finish-workout-btn').addEventListener('click', async () => {
      await App.commands.finishWorkout(workout.id);
      App.router.go('/today');
    });

    container.querySelector('#cancel-workout-btn').addEventListener('click', async () => {
      if (!confirm('Discard this workout? Everything logged will be deleted.')) return;
      await App.commands.cancelWorkout(workout.id);
      App.router.go('/today');
    });
  }

  function exerciseBlockHtml(we, ex, prevSets, mySets) {
    const prevHtml = prevSets ? prevSets.map((s, i) => `
      <div class="prev-set-row">
        <span>${s.weight}×${s.reps}</span>
        <button class="prev-copy-btn" data-copy-weight="${s.weight}" data-copy-reps="${s.reps}">Copy</button>
      </div>
    `).join('') : '<p class="empty-hint" style="padding:4px 0">No history yet</p>';

    const rows = mySets.map((s, i) => setRowHtml(s, i)).join('');

    return `
      <div class="exercise-block" data-we="${we.id}" data-exercise="${ex.id}">
        <div class="exercise-block-header">
          <div class="exercise-name">${ex.name}</div>
          <button class="exercise-remove" data-we="${we.id}" aria-label="Remove exercise">Remove</button>
        </div>
        <div class="exercise-previous">
          <div class="exercise-previous-label">Previous</div>
          ${prevHtml}
        </div>
        <div class="set-rows">${rows}</div>
        <button class="btn-add-set" data-we="${we.id}">+ Add Set</button>
      </div>
    `;
  }

  function setRowHtml(set, index) {
    const complete = App.commands.isSetCompleted(set);
    return `
      <div class="set-row ${complete ? 'set-row-complete' : 'set-row-planned'}" data-set="${set.id}">
        <span class="set-index">${index + 1}</span>
        <input type="number" inputmode="decimal" class="set-weight" value="${set.weight != null ? set.weight : ''}" placeholder="wt">
        <span class="set-x">×</span>
        <input type="number" inputmode="numeric" class="set-reps" value="${set.reps != null ? set.reps : ''}" placeholder="reps">
        <span class="set-check">${complete ? '✓' : ''}</span>
        <button class="set-remove" aria-label="Remove set">×</button>
      </div>
    `;
  }

  function wireBlocks(container, workout) {
    container.querySelectorAll('.btn-add-set').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const weId = btn.dataset.we;
        const we = await App.db.get('workoutExercises', weId);
        const newSet = await App.commands.addEmptySet(we);
        const block = btn.closest('.exercise-block');
        const index = block.querySelectorAll('.set-row').length;
        const row = App.utils.el(setRowHtml(newSet, index));
        block.querySelector('.set-rows').appendChild(row);
        wireSetRow(row);
      });
    });

    container.querySelectorAll('.prev-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const block = btn.closest('.exercise-block');
        const weId = block.dataset.we;
        const we = await App.db.get('workoutExercises', weId);
        const weight = parseFloat(btn.dataset.copyWeight);
        const reps = parseInt(btn.dataset.copyReps, 10);
        const newSet = await App.commands.copyPreviousToNewSet(we, { weight, reps });
        const index = block.querySelectorAll('.set-row').length;
        const row = App.utils.el(setRowHtml(newSet, index));
        block.querySelector('.set-rows').appendChild(row);
        wireSetRow(row);
      });
    });

    container.querySelectorAll('.exercise-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this exercise and its logged sets from this workout?')) return;
        await App.commands.removeExerciseFromWorkout(btn.dataset.we);
        App.router.render();
      });
    });

    container.querySelectorAll('.set-row').forEach((row) => wireSetRow(row));
  }

  function wireSetRow(row) {
    const setId = row.dataset.set;
    const weightInput = row.querySelector('.set-weight');
    const repsInput = row.querySelector('.set-reps');
    const removeBtn = row.querySelector('.set-remove');
    const checkEl = row.querySelector('.set-check');

    const save = App.utils.debounce(async () => {
      const weight = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
      const reps = repsInput.value !== '' ? parseInt(repsInput.value, 10) : null;
      const updated = await App.commands.updateSet(setId, { weight, reps });
      const complete = App.commands.isSetCompleted(updated);
      row.classList.toggle('set-row-complete', complete);
      row.classList.toggle('set-row-planned', !complete);
      checkEl.textContent = complete ? '✓' : '';
    }, 300);

    weightInput.addEventListener('input', save);
    repsInput.addEventListener('input', save);

    removeBtn.addEventListener('click', async () => {
      await App.commands.deleteSet(setId);
      row.remove();
    });
  }

  async function openExercisePicker(onSelect) {
    const exercises = (await App.queries.getExercises()).sort((a, b) => a.name.localeCompare(b.name));

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet modal-sheet-search">
          <div class="modal-header">
            <h2>Add Exercise</h2>
            <button class="modal-close">×</button>
          </div>
          <input type="text" class="modal-search" placeholder="Search exercises">
          <div class="modal-list"></div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('.modal-list');
    function renderList(filter) {
      const f = (filter || '').toLowerCase();
      const filtered = exercises.filter(e => e.name.toLowerCase().includes(f));
      listEl.innerHTML = filtered.map(e => `
        <button class="modal-list-item" data-id="${e.id}">
          <span>${e.name}</span>
          <span class="modal-list-sub">${e.category}</span>
        </button>
      `).join('') || '<p class="empty-hint">No matches</p>';
      listEl.querySelectorAll('.modal-list-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ex = exercises.find(e => e.id === btn.dataset.id);
          overlay.remove();
          onSelect(ex);
        });
      });
    }
    renderList('');
    overlay.querySelector('.modal-search').addEventListener('input', (e) => renderList(e.target.value));
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }
})();
