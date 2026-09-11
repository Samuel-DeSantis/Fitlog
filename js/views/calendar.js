window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.calendar = async function (container) {
    const workouts = await App.queries.getAllCompletedWorkouts();

    container.innerHTML = `
      <div class="view-header">
        <h1>Calendar</h1>
        <p class="view-subhead">Completed workouts</p>
      </div>
      <div class="section">
        ${workouts.length ? workouts.map(w => `
          <button class="list-row" data-id="${w.id}" style="width:100%">
            <div>
              <div class="list-row-title">${App.utils.formatDateLabel(w.date)} — ${w.title}</div>
              <div class="list-row-sub">${App.utils.formatTime(w.endedAt)}</div>
            </div>
            <div class="list-row-right list-row-action">Open</div>
          </button>
        `).join('') : '<p class="empty-hint">No completed workouts yet.</p>'}
      </div>
      <p class="section-note">Month and week views, planned workouts, and backdating a new entry are coming in a later phase.</p>
    `;

    container.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => App.router.go('/workout/' + btn.dataset.id));
    });
  };
})();
