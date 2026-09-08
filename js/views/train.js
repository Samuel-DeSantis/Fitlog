window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.train = async function (container) {
    const workouts = await App.db.getAll('workouts');
    const active = workouts.find(w => !w.endedAt);
    if (active) {
      await renderActiveWorkout(container, active);
    } else {
      await renderStart(container, workouts);
    }
  };

  async function renderStart(container, workouts) {
    const templates = await App.db.getAll('templates');
    const completed = workouts.filter(w => w.endedAt).sort((a, b) => b.date.localeCompare(a.date));
    const last = completed[0];

    container.innerHTML = `
      <div class="view-header"><h1>Train</h1></div>
      <div class="section">
        ${last ? `
          <button class="list-card" id="repeat-last">
            <div class="list-card-title">Repeat ${last.title || 'Last Workout'}</div>
            <div class="list-card-sub">Last done ${App.utils.formatDateLabel(last.date)}</div>
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
      container.querySelector('#repeat-last').addEventListener('click', async () => {
        const allSets = await App.db.getAll('sets');
        const lastSets = allSets.filter(s => s.workoutId === last.id).sort((a, b) => a.setIndex - b.setIndex);
        const exerciseIds = [...new Set(lastSets.map(s => s.exerciseId))];
        await startWorkout(last.title, exerciseIds);
        App.router.render();
      });
    }

    container.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const t = templates.find(tt => tt.id === btn.dataset.template);
        const exerciseIds = [...t.exercises].sort((a, b) => a.order - b.order).map(e => e.exerciseId);
        await startWorkout(t.name, exerciseIds);
        App.router.render();
      });
    });

    container.querySelector('#new-workout').addEventListener('click', async () => {
      await startWorkout('Workout', []);
      App.router.render();
    });
  }

  async function startWorkout(title, exerciseIds) {
    const workout = {
      id: App.utils.uuid(),
      date: App.utils.todayISO(),
      title,
      templateId: null,
      notes: '',
      startedAt: App.utils.nowISO(),
      endedAt: null,
      createdAt: App.utils.nowISO(),
      updatedAt: App.utils.nowISO(),
      exerciseOrder: exerciseIds
    };
    await App.db.put('workouts', workout);
    return workout;
  }

  async function renderActiveWorkout(container, workout) {
    const [allSets, allExercises, allWorkouts] = await Promise.all([
      App.db.getAll('sets'),
      App.db.getAll('exercises'),
      App.db.getAll('workouts')
    ]);
    const exerciseMap = Object.fromEntries(allExercises.map(e => [e.id, e]));
    const wMap = Object.fromEntries(allWorkouts.map(w => [w.id, w]));
    const currentSets = allSets.filter(s => s.workoutId === workout.id);

    function previousSetsFor(exerciseId) {
      const prior = allSets.filter(s => s.exerciseId === exerciseId && s.workoutId !== workout.id);
      if (!prior.length) return null;
      const byWorkout = {};
      prior.forEach(s => { (byWorkout[s.workoutId] = byWorkout[s.workoutId] || []).push(s); });
      const workoutIds = Object.keys(byWorkout)
        .sort((a, b) => (wMap[b] && wMap[b].date || '').localeCompare(wMap[a] && wMap[a].date || ''));
      return byWorkout[workoutIds[0]].sort((a, b) => a.setIndex - b.setIndex);
    }

    const exerciseIds = (workout.exerciseOrder && workout.exerciseOrder.length)
      ? workout.exerciseOrder
      : [...new Set(currentSets.map(s => s.exerciseId))];

    let blocksHtml = '';
    for (const exId of exerciseIds) {
      const ex = exerciseMap[exId];
      if (!ex) continue;
      const prevSets = previousSetsFor(exId);
      const mySets = currentSets.filter(s => s.exerciseId === exId).sort((a, b) => a.setIndex - b.setIndex);
      blocksHtml += exerciseBlockHtml(ex, prevSets, mySets);
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

    wireExerciseBlocks(container, workout);

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      openExercisePicker(async (ex) => {
        workout.exerciseOrder = [...(workout.exerciseOrder || []), ex.id];
        workout.updatedAt = App.utils.nowISO();
        await App.db.put('workouts', workout);
        App.router.render();
      });
    });

    container.querySelector('#finish-workout-btn').addEventListener('click', async () => {
      workout.endedAt = App.utils.nowISO();
      workout.updatedAt = App.utils.nowISO();
      await App.db.put('workouts', workout);
      App.router.go('/today');
    });

    container.querySelector('#cancel-workout-btn').addEventListener('click', async () => {
      if (!confirm('Discard this workout? Logged sets will be deleted.')) return;
      const sets = (await App.db.getAll('sets')).filter(s => s.workoutId === workout.id);
      for (const s of sets) await App.db.remove('sets', s.id);
      await App.db.remove('workouts', workout.id);
      App.router.go('/today');
    });
  }

  function exerciseBlockHtml(ex, prevSets, mySets) {
    const rows = mySets.map((s, i) => setRowHtml(s, i)).join('');
    const prevText = prevSets ? prevSets.map(s => `${s.weight}×${s.reps}`).join(', ') : 'No history yet';
    return `
      <div class="exercise-block" data-exercise="${ex.id}">
        <div class="exercise-name">${ex.name}</div>
        <div class="exercise-previous">Previous: ${prevText}</div>
        <div class="set-rows">${rows}</div>
        <button class="btn-add-set" data-exercise="${ex.id}">+ Add Set</button>
      </div>
    `;
  }

  function setRowHtml(set, index) {
    return `
      <div class="set-row" data-set="${set.id}">
        <span class="set-index">${index + 1}</span>
        <input type="number" inputmode="decimal" class="set-weight" value="${set.weight != null ? set.weight : ''}" placeholder="wt">
        <span class="set-x">×</span>
        <input type="number" inputmode="numeric" class="set-reps" value="${set.reps != null ? set.reps : ''}" placeholder="reps">
        <button class="set-remove" aria-label="Remove set">×</button>
      </div>
    `;
  }

  function wireExerciseBlocks(container, workout) {
    container.querySelectorAll('.btn-add-set').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const exId = btn.dataset.exercise;
        const block = btn.closest('.exercise-block');
        const existingRows = block.querySelectorAll('.set-row').length;

        const allSets = await App.db.getAll('sets');
        const mySets = allSets.filter(s => s.workoutId === workout.id && s.exerciseId === exId);
        let suggestWeight = null, suggestReps = null;
        if (mySets.length) {
          const lastRow = [...mySets].sort((a, b) => a.setIndex - b.setIndex).slice(-1)[0];
          suggestWeight = lastRow.weight;
          suggestReps = lastRow.reps;
        } else {
          const priorAll = allSets.filter(s => s.exerciseId === exId && s.workoutId !== workout.id);
          if (priorAll.length) {
            const workoutsAll = await App.db.getAll('workouts');
            const wMap = Object.fromEntries(workoutsAll.map(w => [w.id, w]));
            priorAll.sort((a, b) => (wMap[b.workoutId] && wMap[b.workoutId].date || '').localeCompare(wMap[a.workoutId] && wMap[a.workoutId].date || ''));
            suggestWeight = priorAll[0].weight;
            suggestReps = priorAll[0].reps;
          }
        }

        const newSet = {
          id: App.utils.uuid(),
          workoutId: workout.id,
          exerciseId: exId,
          setIndex: existingRows,
          weight: suggestWeight,
          reps: suggestReps,
          rpe: null,
          completedAt: App.utils.nowISO()
        };
        await App.db.put('sets', newSet);
        const row = App.utils.el(setRowHtml(newSet, existingRows));
        block.querySelector('.set-rows').appendChild(row);
        wireSetRow(row);
      });
    });

    container.querySelectorAll('.set-row').forEach((row) => wireSetRow(row));
  }

  function wireSetRow(row) {
    const setId = row.dataset.set;
    const weightInput = row.querySelector('.set-weight');
    const repsInput = row.querySelector('.set-reps');
    const removeBtn = row.querySelector('.set-remove');

    const save = App.utils.debounce(async () => {
      const set = await App.db.get('sets', setId);
      if (!set) return;
      set.weight = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
      set.reps = repsInput.value !== '' ? parseInt(repsInput.value, 10) : null;
      await App.db.put('sets', set);
    }, 300);

    weightInput.addEventListener('input', save);
    repsInput.addEventListener('input', save);

    removeBtn.addEventListener('click', async () => {
      await App.db.remove('sets', setId);
      row.remove();
    });
  }

  async function openExercisePicker(onSelect) {
    const exercises = (await App.db.getAll('exercises'))
      .filter(e => !e.archived)
      .sort((a, b) => a.name.localeCompare(b.name));

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
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
