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

    // Exercises whose exercise record no longer resolves (defensive only —
    // exercises are archived, never hard-deleted) are skipped entirely, so
    // numbering/reorder-boundary state below is based on what actually
    // renders, not the raw stored order.
    const renderableIds = workout.exerciseOrder.filter(id => exerciseMap[id]);

    let blocksHtml = '';
    for (let i = 0; i < renderableIds.length; i++) {
      const ex = exerciseMap[renderableIds[i]];
      const [mySets, prevSets] = await Promise.all([
        App.queries.getSetsForWorkoutExercise(workout.id, ex.id),
        App.queries.getPreviousPerformance(ex.id, workout.id)
      ]);
      blocksHtml += exerciseBlockHtml(ex, prevSets, mySets, i, renderableIds.length);
    }

    const trimmedNotes = (workout.notes || '').trim();

    container.innerHTML = `
      <div class="view-header">
        <button class="back-btn" id="back-btn">‹ ${isActive ? 'Train' : 'Calendar'}</button>
        <h1>${App.utils.escapeHtml(workout.title)}</h1>
        <p class="view-subhead">
          ${App.utils.formatDateLabel(workout.date)}
          <span class="status-pill ${isActive ? 'status-pill-active' : 'status-pill-done'}">${isActive ? 'In Progress' : 'Completed'}</span>
          <button class="list-row-action" id="edit-meta-btn">Edit details</button>
        </p>
        ${trimmedNotes ? `<button class="workout-notes-preview" id="notes-preview-btn">Notes: ${App.utils.escapeHtml(truncateNotes(trimmedNotes, 90))}</button>` : ''}
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

    const notesBtn = container.querySelector('#notes-preview-btn');
    if (notesBtn) notesBtn.addEventListener('click', () => openEditMetaModal(workout, 'notes'));

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      App.ui.openExercisePicker(workout.exerciseOrder, async (ex) => {
        await App.commands.addExerciseToWorkout(workout.id, ex.id);
        App.router.render();
      });
    });

    if (isActive) {
      container.querySelector('#finish-workout-btn').addEventListener('click', async () => {
        // Warn rather than silently discard — the user can back out and
        // keep logging, or confirm and finish with the gaps left as-is.
        const allSets = await App.queries.getSetsForWorkout(workout.id);
        const incomplete = allSets.filter(s => !App.commands.isSetCompleted(s));
        if (incomplete.length) {
          const noun = incomplete.length === 1 ? 'set' : 'sets';
          const proceed = confirm(
            `This workout has ${incomplete.length} incomplete ${noun}. Finish anyway? ` +
            `Nothing will be deleted — you can still come back and fill them in later.`
          );
          if (!proceed) return;
        }
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

  // Consecutive sets at the same weight only need the reps repeated — the
  // weight is implied until it actually changes. E.g. 135×8, 135×8, 135×6
  // becomes "135×8, 8, 6"; a weight change (145×6 after 135s) always
  // re-states the weight.
  function formatPreviousPerformance(sets) {
    let lastWeight = null;
    return sets.map((s) => {
      const sameAsLast = lastWeight !== null && s.weight === lastWeight;
      lastWeight = s.weight;
      return sameAsLast ? `${s.reps}` : `${s.weight}×${s.reps}`;
    }).join(', ');
  }

  function exerciseBlockHtml(ex, prevSets, mySets, position, total) {
    const prevText = prevSets && prevSets.length ? formatPreviousPerformance(prevSets) : null;

    // The "current" set is the first not-yet-completed one, in order —
    // i.e. the next one the user actually needs to log. Reference-only
    // previous performance is never copied into it; this only decides
    // which existing row gets the "you are here" highlight.
    const currentIndex = mySets.findIndex(s => !App.commands.isSetCompleted(s));
    const rows = mySets.map((s, i) => setRowHtml(s, i, i === currentIndex)).join('');

    const isFirst = position === 0;
    const isLast = position === total - 1;

    return `
      <div class="exercise-block" data-exercise="${ex.id}">
        <div class="exercise-block-header">
          <div class="exercise-name">${position + 1}. ${App.utils.escapeHtml(ex.name)}</div>
          <div class="exercise-block-actions">
            <button class="exercise-reorder-btn" data-dir="up" aria-label="Move exercise up" ${isFirst ? 'disabled' : ''}>↑</button>
            <button class="exercise-reorder-btn" data-dir="down" aria-label="Move exercise down" ${isLast ? 'disabled' : ''}>↓</button>
            <button class="exercise-remove" data-exercise="${ex.id}">Remove</button>
          </div>
        </div>
        ${prevText ? `<div class="exercise-previous">Previous: ${prevText}</div>` : ''}
        ${rows ? `<div class="set-header-row"><span class="set-index-col"></span><span class="set-input-col">Weight</span><span class="set-input-col">Reps</span><span class="set-check-col"></span><span class="set-end-col"></span></div>` : ''}
        <div class="set-rows">${rows}</div>
        <button class="btn-add-set" data-exercise="${ex.id}">+ Add Set</button>
      </div>
    `;
  }

  function setRowHtml(set, index, isCurrent) {
    const complete = App.commands.isSetCompleted(set);
    const hasValues = set.weight != null && set.reps != null;
    const rowClasses = ['set-row'];
    if (!complete) rowClasses.push('set-row-planned');
    if (isCurrent) rowClasses.push('set-row-current');
    return `
      <div class="${rowClasses.join(' ')}" data-set="${set.id}">
        <span class="set-index">${index + 1}</span>
        <input type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off"
          class="set-weight" value="${set.weight != null ? set.weight : ''}" placeholder="0">
        <input type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off"
          class="set-reps" value="${set.reps != null ? set.reps : ''}" placeholder="0">
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
        const row = App.utils.el(setRowHtml(newSet, index, false));
        block.querySelector('.set-rows').appendChild(row);
        wireSetRow(row);
        refreshCurrentSet(block);

        // Jump straight into entry for the set that was just added. The
        // 'focus' listener wired in wireSetRow() handles selecting the
        // (empty) value and scrolling clear of the mobile keyboard once
        // it opens — deferred a tick so the new row exists in layout
        // before anything tries to scroll to it.
        const weightInput = row.querySelector('.set-weight');
        setTimeout(() => weightInput.focus(), 0);
      });
    });

    container.querySelectorAll('.exercise-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this exercise and its logged sets from this workout?')) return;
        await App.commands.removeExerciseFromWorkout(workout.id, btn.dataset.exercise);
        App.router.render();
      });
    });

    // Simple, reliable up/down reordering (no drag gestures) — swap the
    // two DOM blocks directly and persist the resulting order, rather
    // than a full re-render, so the screen doesn't jump/reset scroll
    // position for what's a small, local change.
    container.querySelectorAll('.exercise-reorder-btn[data-dir="up"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const block = btn.closest('.exercise-block');
        const prev = block.previousElementSibling;
        if (!prev || !prev.classList.contains('exercise-block')) return;
        block.parentNode.insertBefore(block, prev);
        await persistExerciseOrder(container, workout);
      });
    });
    container.querySelectorAll('.exercise-reorder-btn[data-dir="down"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const block = btn.closest('.exercise-block');
        const next = block.nextElementSibling;
        if (!next || !next.classList.contains('exercise-block')) return;
        block.parentNode.insertBefore(next, block);
        await persistExerciseOrder(container, workout);
      });
    });

    container.querySelectorAll('.set-row').forEach((row) => wireSetRow(row));
  }

  // Reads the exercise order back out of the DOM (the source of truth
  // after a drag-free up/down swap) and persists it via the same command
  // every other reorder path uses, then refreshes which arrows are
  // disabled at the new top/bottom.
  async function persistExerciseOrder(container, workout) {
    const ids = [...container.querySelectorAll('.exercise-block')].map(b => b.dataset.exercise);
    workout.exerciseOrder = ids;
    await App.commands.reorderExercises(workout.id, ids);
    updateReorderButtonStates(container);
  }

  function updateReorderButtonStates(container) {
    const blocks = [...container.querySelectorAll('.exercise-block')];
    blocks.forEach((block, i) => {
      const upBtn = block.querySelector('.exercise-reorder-btn[data-dir="up"]');
      const downBtn = block.querySelector('.exercise-reorder-btn[data-dir="down"]');
      if (upBtn) upBtn.disabled = i === 0;
      if (downBtn) downBtn.disabled = i === blocks.length - 1;
    });
  }

  // The single source of truth for which row is "current" within one
  // exercise block: the first (lowest setOrder) row that isn't complete.
  // Re-run after anything that can change a block's completion order —
  // adding/removing a set, confirming/un-confirming one, or an edit that
  // auto-completes it — so the highlight always tracks the real next set,
  // never a stale one left over from before the change.
  function refreshCurrentSet(block) {
    if (!block) return;
    let claimed = false;
    block.querySelectorAll('.set-row').forEach((row) => {
      const incomplete = row.classList.contains('set-row-planned');
      const isCurrent = incomplete && !claimed;
      row.classList.toggle('set-row-current', isCurrent);
      if (isCurrent) claimed = true;
    });
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
    refreshCurrentSet(row.closest('.exercise-block'));
  }

  // Keeps only digits (and, for weight, a single decimal point) as the
  // user types — type="text" + inputmode is used instead of type="number"
  // so editing behaves consistently across browsers (full-value select,
  // no native step spinners, no scientific-notation "e" characters), but
  // that means nothing stops non-numeric input at the browser level, so
  // it's enforced here instead.
  function sanitizeNumericValue(raw, allowDecimal) {
    let cleaned = allowDecimal ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '');
    if (allowDecimal) {
      const firstDot = cleaned.indexOf('.');
      if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
      }
    }
    return cleaned;
  }

  // Selects the existing value so the next keystroke replaces it outright
  // (the common case when re-logging a set), and — once the mobile
  // keyboard has had a moment to finish animating in — scrolls the field
  // clear of it. Both steps are best-effort: some browsers can decline to
  // support select() on certain input types, and environments without
  // real layout (or a user who has already moved on) can no-op
  // scrollIntoView; neither should ever break typing.
  function focusAndScroll(input) {
    if (typeof input.select === 'function') {
      try { input.select(); } catch (e) { /* selection unsupported here — not fatal */ }
    }
    if (typeof input.scrollIntoView === 'function') {
      setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
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

    weightInput.addEventListener('input', () => {
      weightInput.value = sanitizeNumericValue(weightInput.value, true);
      save();
    });
    repsInput.addEventListener('input', () => {
      repsInput.value = sanitizeNumericValue(repsInput.value, false);
      save();
    });

    weightInput.addEventListener('focus', () => focusAndScroll(weightInput));
    repsInput.addEventListener('focus', () => focusAndScroll(repsInput));

    // Logical focus flow for fast entry: Enter/Go on Weight advances to
    // Reps (matching enterkeyhint="next" on that field); Enter/Go on Reps
    // dismisses the keyboard (matching enterkeyhint="done"), since it's
    // the last field in the row.
    weightInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); repsInput.focus(); }
    });
    repsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); repsInput.blur(); }
    });

    // Explicit confirm/un-confirm — the only way a set with copied-but-
    // untouched values becomes "done" without retyping the same numbers.
    checkBtn.addEventListener('click', async () => {
      const current = await App.db.get('sets', setId);
      if (!current) return;
      const updated = await App.commands.setSetCompleted(setId, !App.commands.isSetCompleted(current));
      applySetRowState(row, updated);
    });

    removeBtn.addEventListener('click', async () => {
      const block = row.closest('.exercise-block');
      await App.commands.deleteSet(setId);
      row.remove();
      refreshCurrentSet(block);
    });
  }

  function truncateNotes(str, max) {
    if (str.length <= max) return str;
    return str.slice(0, max - 1).trimEnd() + '…';
  }

  // focusField optionally jumps straight to a specific field once the
  // sheet opens — used by the notes preview so tapping it goes directly
  // into editing notes rather than landing on Title.
  function openEditMetaModal(workout, focusField) {
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

    if (focusField === 'notes') {
      const notesField = overlay.querySelector('#mf-notes');
      notesField.focus();
      if (typeof notesField.select === 'function') {
        try { notesField.select(); } catch (e) { /* selection unsupported here — not fatal */ }
      }
    }

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
