window.App = window.App || {};

App.ui = (function () {
  // Fixed-height sheet: the search field never moves as the result count
  // changes, because the list scrolls independently underneath it rather
  // than the whole sheet resizing around its content.
  async function openExercisePicker(excludeIds, onSelect) {
    const exercises = (await App.queries.getExercises())
      .filter(e => !excludeIds.includes(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));

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
        <button class="modal-list-item" data-id="${e.id}"><span>${e.name}</span></button>
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

  return { openExercisePicker };
})();
