window.App = window.App || {};
App.views = App.views || {};

(function () {
  // Fixed window rendered around "today" rather than infinite scroll or
  // month-by-month paging — bounded, still a single indexed range query,
  // and gives "some recent history, some upcoming plans" without needing
  // pagination machinery.
  const MONTHS_BACK = 6;
  const MONTHS_FORWARD = 3;

  App.views.calendar = async function (container) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth0 = now.getMonth();

    const months = [];
    for (let offset = -MONTHS_BACK; offset <= MONTHS_FORWARD; offset++) {
      months.push(App.utils.addMonthsLocal(currentYear, currentMonth0, offset));
    }

    const first = App.utils.dateAtLocal(months[0].year, months[0].month, 1);
    const lastMonth = months[months.length - 1];
    const last = App.utils.dateAtLocal(lastMonth.year, lastMonth.month, App.utils.daysInMonth(lastMonth.year, lastMonth.month));

    const [completedWorkouts, entryPairs, sessions] = await Promise.all([
      App.queries.getCompletedWorkoutsInRange(first, last),
      App.queries.getCalendarEntriesWithWorkouts(first, last),
      App.queries.getSessions()
    ]);
    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

    const completedByDate = {};
    completedWorkouts.forEach((w) => { (completedByDate[w.date] = completedByDate[w.date] || []).push(w); });

    // A plan whose workout is already completed is represented by the
    // FILLED dot above instead — showing both would be a duplicate for
    // the same occurrence.
    const plannedByDate = {};
    entryPairs.forEach((pair) => {
      if (App.queries.calendarEntryStatus(pair) === 'completed') return;
      (plannedByDate[pair.entry.date] = plannedByDate[pair.entry.date] || []).push(pair);
    });

    const todayStr = App.utils.todayLocalISO();
    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const monthBlocksHtml = months
      .map(({ year, month }) => renderMonthBlock(year, month, completedByDate, plannedByDate, sessionMap, todayStr))
      .join('');

    container.innerHTML = `
      <div class="view-header"><h1>Calendar</h1></div>
      <div class="calendar-weekdays">${weekdayLabels.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="calendar-scroll" id="calendar-scroll">${monthBlocksHtml}</div>
    `;

    container.querySelectorAll('.calendar-day[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => openDayDetail(btn.dataset.date));
    });

    // Land on today with some history visible above and upcoming plans
    // below, rather than at the top of the scroll.
    const todayCell = container.querySelector(`.calendar-day[data-date="${todayStr}"]`);
    if (todayCell && typeof todayCell.scrollIntoView === 'function') {
      todayCell.scrollIntoView({ block: 'center' });
    }
  };

  function renderMonthBlock(year, month0, completedByDate, plannedByDate, sessionMap, todayStr) {
    const firstWeekday = App.utils.firstWeekdayOfMonth(year, month0);
    const numDays = App.utils.daysInMonth(year, month0);

    let cellsHtml = '';
    for (let i = 0; i < firstWeekday; i++) {
      cellsHtml += '<div class="calendar-day calendar-day-empty"></div>';
    }
    for (let day = 1; day <= numDays; day++) {
      const dateStr = App.utils.dateAtLocal(year, month0, day);
      const dots = [];
      (completedByDate[dateStr] || []).forEach((w) => {
        const session = w.sessionId ? sessionMap[w.sessionId] : null;
        dots.push(`<span class="calendar-dot" style="background:${App.sessionColors.hexFor(session ? session.color : null)}"></span>`);
      });
      (plannedByDate[dateStr] || []).forEach((pair) => {
        const session = pair.entry.sessionId ? sessionMap[pair.entry.sessionId] : null;
        const hex = App.sessionColors.hexFor(session ? session.color : null);
        dots.push(`<span class="calendar-dot calendar-dot-hollow" style="border-color:${hex}"></span>`);
      });

      cellsHtml += `
        <button class="calendar-day ${dateStr === todayStr ? 'is-today' : ''}" data-date="${dateStr}">
          <span>${day}</span>
          <span class="calendar-dots">${dots.join('')}</span>
        </button>
      `;
    }

    return `
      <div class="calendar-month-block" data-month="${year}-${String(month0 + 1).padStart(2, '0')}">
        <div class="calendar-month-heading">${App.utils.formatMonthHeading(year, month0)}</div>
        <div class="calendar-grid">${cellsHtml}</div>
      </div>
    `;
  }

  async function openDayDetail(dateStr) {
    const [completed, entryPairs, sessions] = await Promise.all([
      App.queries.getCompletedWorkoutsInRange(dateStr, dateStr),
      App.queries.getCalendarEntriesWithWorkouts(dateStr, dateStr),
      App.queries.getSessions()
    ]);
    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

    const rowsHtml = [];

    completed.forEach((w) => {
      const session = w.sessionId ? sessionMap[w.sessionId] : null;
      const hex = App.sessionColors.hexFor(session ? session.color : null);
      rowsHtml.push(`
        <div class="day-occurrence">
          <div class="day-occurrence-title"><span class="color-dot" style="background:${hex}"></span>${App.utils.escapeHtml(w.title)}</div>
          <div class="day-occurrence-state">Completed${w.endedAt ? ' ' + App.utils.formatTime(w.endedAt) : ''}</div>
          <div class="day-occurrence-actions">
            <button data-view-workout="${w.id}">View Workout</button>
          </div>
        </div>
      `);
    });

    entryPairs.forEach((pair) => {
      const status = App.queries.calendarEntryStatus(pair);
      if (status === 'completed') return; // already shown above via the workout itself
      const session = pair.entry.sessionId ? sessionMap[pair.entry.sessionId] : null;
      const hex = App.sessionColors.hexFor(session ? session.color : null);
      const name = session ? session.name : 'Workout';
      const isActive = status === 'active';
      rowsHtml.push(`
        <div class="day-occurrence">
          <div class="day-occurrence-title"><span class="color-dot color-dot-hollow" style="border-color:${hex}"></span>${App.utils.escapeHtml(name)}</div>
          <div class="day-occurrence-state">${isActive ? 'In progress' : 'Planned'}</div>
          <div class="day-occurrence-actions">
            <button data-start-entry="${pair.entry.id}">${isActive ? 'Resume Workout' : 'Start Workout'}</button>
            ${!isActive ? `
              <button data-edit-entry="${pair.entry.id}">Edit Plan</button>
              <button class="danger" data-delete-entry="${pair.entry.id}">Delete Plan</button>
            ` : ''}
          </div>
        </div>
      `);
    });

    const isPastOrToday = dateStr <= App.utils.todayLocalISO();

    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${App.utils.formatDateHeading(dateStr)}</h2>
            <button class="modal-close">×</button>
          </div>
          ${rowsHtml.length ? rowsHtml.join('') : '<p class="empty-hint">Nothing planned or logged on this date.</p>'}
          <button class="btn-secondary" id="plan-workout-btn" style="margin-top:16px">+ Plan Workout</button>
          ${isPastOrToday ? '<button class="btn-secondary" id="add-workout-btn">+ Add Workout</button>' : ''}
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('[data-view-workout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.remove();
        App.router.go('/workout/' + btn.dataset.viewWorkout);
      });
    });

    overlay.querySelectorAll('[data-start-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const { workout } = await App.commands.startPlannedWorkout(btn.dataset.startEntry);
          overlay.remove();
          App.router.go('/workout/' + workout.id);
        } catch (err) {
          if (err instanceof App.errors.MultipleActiveWorkoutsError) {
            overlay.remove();
            alert('There\'s a data conflict with active workouts — go to Today to resolve it before starting this one.');
            App.router.go('/today');
            return;
          }
          if (err instanceof App.errors.ActiveWorkoutConflictError) {
            btn.disabled = false;
            alert(`You already have "${err.activeWorkout.title}" in progress. Finish or resume it before starting this workout.`);
            return;
          }
          throw err;
        }
      });
    });

    overlay.querySelectorAll('[data-edit-entry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.remove();
        openSessionPicker('Change Session', async (session) => {
          await App.commands.updateCalendarEntry(btn.dataset.editEntry, { sessionId: session ? session.id : null });
          App.router.render();
        });
      });
    });

    overlay.querySelectorAll('[data-delete-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this planned workout? The Session itself is not affected.')) return;
        await App.commands.deleteCalendarEntry(btn.dataset.deleteEntry);
        overlay.remove();
        App.router.render();
      });
    });

    overlay.querySelector('#plan-workout-btn').addEventListener('click', () => {
      overlay.remove();
      openSessionPicker('Plan Workout', async (session) => {
        await App.commands.planCalendarEntry(dateStr, session ? session.id : null);
        App.router.render();
      });
    });

    const addWorkoutBtn = overlay.querySelector('#add-workout-btn');
    if (addWorkoutBtn) {
      addWorkoutBtn.addEventListener('click', () => {
        overlay.remove();
        openSessionPicker('Add Workout', async (session) => {
          const workout = await App.commands.backfillWorkout(dateStr, session ? session.id : null);
          App.router.go('/workout/' + workout.id);
        });
      });
    }
  }

  async function openSessionPicker(title, onSelect) {
    const sessions = await App.queries.getSessions();
    const overlay = App.utils.el(`
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <h2>${App.utils.escapeHtml(title)}</h2>
            <button class="modal-close">×</button>
          </div>
          <div class="modal-list">
            <button class="modal-list-item" data-blank><span>Blank workout (no session)</span></button>
            ${sessions.map(s => `
              <button class="modal-list-item" data-session="${s.id}">
                <span><span class="color-dot" style="background:${App.sessionColors.hexFor(s.color)}"></span>${App.utils.escapeHtml(s.name)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('[data-blank]').addEventListener('click', () => {
      overlay.remove();
      onSelect(null);
    });
    overlay.querySelectorAll('[data-session]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const session = sessions.find(s => s.id === btn.dataset.session);
        overlay.remove();
        onSelect(session);
      });
    });
  }
})();
