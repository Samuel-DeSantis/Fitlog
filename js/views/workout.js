window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.workout = async function (container, parts) {
    const workoutId = parts[0];
    const workout = await App.queries.getWorkout(workoutId);
    if (!workout) {
      container.innerHTML = `
        <div class="view-header"><h1>Not found</h1></div>
        <p class="empty-hint">This workout no longer exists.</p>
        <button class="btn-secondary" id="back-btn">Back to Today</button>
      `;
      container.querySelector('#back-btn').addEventListener('click', () => App.router.go('/today'));
      return;
    }
    await renderWorkout(container, workout);
  };

  async function renderWorkout(container, workout) {
    const exercises = await App.queries.getExercises(true);
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const isActive = workout.status === 'active';

    let blocksHtml = '';
    for (const exId of workout.exerciseOrder) {
      const ex = exerciseMap[exId];
      if (!ex) continue;
      const [mySets, prevSets] = await Promise.all([
        App.queries.getSetsForWorkoutExercise(workout.id, exId),
        App.queries.getPreviousPerformance(exId, workout.id)
      ]);
      blocksHtml += exerciseBlockHtml(ex, prevSets, mySets);
    }

    container.innerHTML = `
      <div class="view-header">
        <button class="back-btn" id="back-btn">‹ ${isActive ? 'Train' : 'Calendar'}</button>
        <h1>${App.utils.escapeHtml(workout.title)}</h1>
        <p class="view-subhead">
          ${App.utils.formatDateLabel(workout.date)}${isActive ? ' · in progress' : ''}
          <button class="list-row-action" id="edit-meta-btn">Edit details</button>
        </p>
      </div>
      <div id="exercise-blocks">${blocksHtml || '<p class="empty-hint">No exercises yet. Add one below.</p>'}</div>
      <button class="btn-secondary" id="add-exercise-btn">+ Add Exercise</button>
      ${isActive ? `
        <button class="btn-primary" id="finish-workout-btn">Finish Workout</button>
        <button class="btn-text" id="cancel-workout-btn">Cancel Workout</button>
      ` : `
        <button class="btn-primary" id="save-btn">Save Changes</button>
        <button class="btn-danger" id="delete-workout-btn" style="margin-top:12px">Delete Workout</button>
      `}
    `;

    wireBlocks(container, workout);

    container.querySelector('#back-btn').addEventListener('click', () => App.router.go(isActive ? '/train' : '/calendar'));
    container.querySelector('#edit-meta-btn').addEventListener('click', () => openEditMetaModal(workout));

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      App.ui.openExercisePicker(workout.exerciseOrder, async (ex) => {
        await App.commands.addExerciseToWorkout(workout.id, ex.id);
        App.router.render();
      });
    });

    if (isActive) {
      container.querySelector('#finish-workout-btn').addEventListener('click', async () => {
        await App.commands.finishWorkout(workout.id);
        App.router.go('/today');
      });
      container.querySelector('#cancel-workout-btn').addEventListener('click', async () => {
        if (!confirm('Discard this workout? Everything logged will be deleted.')) return;
        await App.commands.deleteWorkout(workout.id);
        App.router.go('/today');
      });
    } else {
      container.querySelector('#save-btn').addEventListener('click', () => App.router.go('/calendar'));
      container.querySelector('#delete-workout-btn').addEventListener('click', async () => {
        if (!confirm('Delete this workout permanently? This cannot be undone.')) return;
        await App.commands.deleteWorkout(workout.id);
        App.router.go('/calendar');
      });
    }
  }

  function exerciseBlockHtml(ex, prevSets, mySets) {
    const prevText = prevSets ? prevSets.map(s => `${s.weight}×${s.reps}`).join(', ') : null;
    const rows = mySets.map((s, i) => setRowHtml(s, i)).join('');
    return `
      <div class="exercise-block" data-exercise="${ex.id}">
        <div class="exercise-block-header">
          <div class="exercise-name">${App.utils.escapeHtml(ex.name)}</div>
          <button class="exercise-remove" data-exercise="${ex.id}">Remove</button>
        </div>
        ${prevText ? `<div class="exercise-previous">Previous: ${prevText}</div>` : ''}
        ${rows ? `<div class="set-header-row"><span class="set-index-col"></span><span class="set-input-col">Weight</span><span class="set-input-col">Reps</span><span class="set-check-col"></span><span class="set-end-col"></span></div>` : ''}
        <div class="set-rows">${rows}</div>
        <button class="btn-add-set" data-exercise="${ex.id}">+ Add Set</button>
      </div>
    `;
  }

  function setRowHtml(set, index) {
    const complete = App.commands.isSetCompleted(set);
    const hasValues = set.weight != null && set.reps != null;
    return `
      <div class="set-row ${complete ? '' : 'set-row-planned'}" data-set="${set.id}">
        <span class="set-index">${index + 1}</span>
        <input type="number" inputmode="decimal" class="set-weight" value="${set.weight != null ? set.weight : ''}" placeholder="0">
        <input type="number" inputmode="numeric" class="set-reps" value="${set.reps != null ? set.reps : ''}" placeholder="0">
        <button class="set-check ${complete ? 'set-check-on' : ''}" data-set-check
          aria-label="${complete ? 'Mark set not done' : 'Mark set done'}" ${hasValues ? '' : 'disabled'}
        >${complete ? '✓' : ''}</button>
        <button class="set-remove" aria-label="Remove set">×</button>
      </div>
    `;
  }

  function wireBlocks(container, workout) {
    container.querySelectorAll('.btn-add-set').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const exId = btn.dataset.exercise;
        const newSet = await App.commands.addSet(workout.id, exId);
        const block = btn.closest('.exercise-block');
        let header = block.querySelector('.set-header-row');
        if (!header) {
          header = App.utils.el('<div class="set-header-row"><span class="set-index-col"></span><span class="set-input-col">Weight</span><span class="set-input-col">Reps</span><span class="set-check-col"></span><span class="set-end-col"></span></div>');
          block.querySelector('.set-rows').before(header);
        }
        const index = block.querySelectorAll('.set-row').length;
        const row = App.utils.el(setRowHtml(newSet, index));
        block.querySelector('.set-rows').appendChild(row);
        wireSetRow(row);
      });
    });

    container.querySelectorAll('.exercise-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this exercise and its logged sets from this workout?')) return;
        await App.commands.removeExerciseFromWorkout(workout.id, btn.dataset.exercise);
        App.router.render();
      });
    });

    container.querySelectorAll('.set-row').forEach((row) => wireSetRow(row));
  }

  function applySetRowState(row, set) {
    const complete = App.commands.isSetCompleted(set);
    const hasValues = set.weight != null && set.reps != null;
    row.classList.toggle('set-row-planned', !complete);
    const checkBtn = row.querySelector('[data-set-check]');
    checkBtn.classList.toggle('set-check-on', complete);
    checkBtn.textContent = complete ? '✓' : '';
    checkBtn.disabled = !hasValues;
    checkBtn.setAttribute('aria-label', complete ? 'Mark set not done' : 'Mark set done');
  }

  function wireSetRow(row) {
    const setId = row.dataset.set;
    const weightInput = row.querySelector('.set-weight');
    const repsInput = row.querySelector('.set-reps');
    const removeBtn = row.querySelector('.set-remove');
    const checkBtn = row.querySelector('[data-set-check]');

    const save = App.utils.debounce(async () => {
      const weight = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
      const reps = repsInput.value !== '' ? parseInt(repsInput.value, 10) : null;
      const updated = await App.commands.updateSet(setId, { weight, reps });
      applySetRowState(row, updated);
    }, 300);

    weightInput.addEventListener('input', save);
    repsInput.addEventListener('input', save);

    // Explicit confirm/un-confirm — the only way a set with copied-but-
    // untouched values becomes "done" without retyping the same numbers.
    checkBtn.addEventListener('click', async () => {
      const current = await App.db.get('sets', setId);
      if (!current) return;
      const updated = await App.commands.setSetCompleted(setId, !App.commands.isSetCompleted(current));
      applySetRowState(row, updated);
    });

    removeBtn.addEventListener('click', async () => {
      await App.commands.deleteSet(setId);
      row.remove();
    });
  }
  function openEditMetaModal(workout) {
    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>Edit Details</h2>
            <button class="modal-close">×</button>
          </div>
          <form class="modal-form" id="meta-form">
            <label>Title<input type="text" id="mf-title" value="${App.utils.escapeHtml(workout.title)}"></label>
            <label>Date<input type="date" id="mf-date" value="${App.utils.escapeHtml(workout.date)}"></label>
            <label>Notes<textarea id="mf-notes" rows="3">${App.utils.escapeHtml(workout.notes || '')}</textarea></label>
            <button type="submit" class="btn-primary">Save</button>
          </form>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#meta-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await App.commands.editWorkoutMeta(workout.id, {
        title: overlay.querySelector('#mf-title').value || 'Workout',
        date: overlay.querySelector('#mf-date').value || workout.date,
        notes: overlay.querySelector('#mf-notes').value
      });
      overlay.remove();
      App.router.render();
    });
  }
})();
