window.App = window.App || {};

App.ui = (function () {
  // Fixed-height sheet: the search field never moves as the result count
  // changes, because the list scrolls independently underneath it rather
  // than the whole sheet resizing around its content.
  //
  // Priority order matches the request: recently-used (shown only in the
  // default browse state), then search, then muscle-group chips — search
  // and the active chip always combine (AND), so search stays the fastest
  // way to find a specific exercise regardless of what's filtered.
  async function openExercisePicker(excludeIds, onSelect) {
    const [allExercises, recentIds] = await Promise.all([
      App.queries.getExercises(),
      App.queries.getRecentlyUsedExerciseIds(8)
    ]);
    const exercises = allExercises
      .filter(e => !excludeIds.includes(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const recentExercises = recentIds.map(id => exerciseMap[id]).filter(Boolean);
    const recentIdSet = new Set(recentExercises.map(e => e.id));

    let activeCategory = 'All';

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet modal-sheet-search">
          <div class="modal-header">
            <h2>Add Exercise</h2>
            <button class="modal-close">×</button>
          </div>
          <input type="text" class="modal-search" placeholder="Search exercises">
          <div class="muscle-chip-row">
            ${App.muscleGroups.CATEGORIES.map(c => `
              <button type="button" class="muscle-chip ${c === 'All' ? 'muscle-chip-active' : ''}" data-category="${c}">${c}</button>
            `).join('')}
          </div>
          <div class="modal-list"></div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('.modal-list');
    const searchInput = overlay.querySelector('.modal-search');

    function itemHtml(e) {
      return `<button class="modal-list-item" data-id="${e.id}"><span>${App.utils.escapeHtml(e.name)}</span></button>`;
    }

    function renderList() {
      const query = searchInput.value.trim().toLowerCase();
      const browsing = !query && activeCategory === 'All';

      if (browsing && recentExercises.length) {
        const rest = exercises.filter(e => !recentIdSet.has(e.id));
        listEl.innerHTML = `
          <div class="modal-list-section-label">Recently Used</div>
          ${recentExercises.map(itemHtml).join('')}
          <div class="modal-list-section-label">All Exercises</div>
          ${rest.map(itemHtml).join('') || '<p class="empty-hint">No other exercises</p>'}
        `;
      } else {
        const filtered = exercises.filter(e =>
          (!query || e.name.toLowerCase().includes(query)) &&
          App.muscleGroups.matchesCategory(e, activeCategory)
        );
        listEl.innerHTML = filtered.map(itemHtml).join('') || '<p class="empty-hint">No matches</p>';
      }

      listEl.querySelectorAll('.modal-list-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ex = exerciseMap[btn.dataset.id];
          overlay.remove();
          onSelect(ex);
        });
      });
    }

    renderList();
    searchInput.addEventListener('input', renderList);
    overlay.querySelectorAll('.muscle-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        activeCategory = chip.dataset.category;
        overlay.querySelectorAll('.muscle-chip').forEach((c) => c.classList.toggle('muscle-chip-active', c === chip));
        renderList();
      });
    });
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // Renders an explicit, non-destructive panel when the active-workout
  // invariant is violated (MultipleActiveWorkoutsError). Nothing is
  // auto-repaired — each workout links to the normal workout screen so the
  // user can finish or delete extras themselves.
  function conflictPanelHtml(err) {
    const rows = err.workouts.map(w => `
      <button class="list-row" data-conflict-id="${App.utils.escapeHtml(w.id)}">
        <div>
          <div class="list-row-title">${App.utils.escapeHtml(w.title)}</div>
          <div class="list-row-sub">${App.utils.escapeHtml(w.date)} · started ${App.utils.escapeHtml(App.utils.formatTime(w.startedAt))}</div>
        </div>
        <div class="list-row-right list-row-action">Open</div>
      </button>
    `).join('');
    return `
      <div class="section">
        <h2>Data conflict</h2>
        <p class="section-note">Found ${err.workouts.length} workouts marked active at the same time — there should only ever be one. Nothing has been changed or deleted. Open each one below and finish or delete it until only one remains active.</p>
        ${rows}
      </div>
    `;
  }

  function wireConflictPanel(container) {
    container.querySelectorAll('[data-conflict-id]').forEach((btn) => {
      btn.addEventListener('click', () => App.router.go('/workout/' + btn.dataset.conflictId));
    });
  }

  return { openExercisePicker, conflictPanelHtml, wireConflictPanel };
})();
