window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.today = async function (container) {
    const today = App.utils.todayLocalISO();

    let activeWorkout, todaysCompleted, plannedPairs;
    try {
      [activeWorkout, todaysCompleted, plannedPairs] = await Promise.all([
        App.queries.getActiveWorkout(),
        App.queries.getCompletedWorkoutsInRange(today, today),
        App.queries.getCalendarEntriesWithWorkouts(today, today)
      ]);
    } catch (err) {
      if (err instanceof App.errors.MultipleActiveWorkoutsError) {
        container.innerHTML = `
          <div class="view-header">
            <h1>Today</h1>
            <p class="view-subhead">${App.utils.formatDateHeading(today)}</p>
          </div>
          ${App.ui.conflictPanelHtml(err)}
        `;
        App.ui.wireConflictPanel(container);
        return;
      }
      throw err;
    }

    let bannerHtml = '';
    if (activeWorkout) {
      const notFromToday = activeWorkout.date !== today;
      bannerHtml = `
        <div class="active-banner">
          <div class="active-banner-label">Workout in progress</div>
          <div class="active-banner-title">${App.utils.escapeHtml(activeWorkout.title)}</div>
          ${notFromToday ? `<div class="section-note" style="margin:2px 0 0">Started ${App.utils.formatDateLabel(activeWorkout.date)}</div>` : ''}
          <button class="btn-primary" id="resume-btn">Resume Workout</button>
        </div>
      `;
    }

    // Just enough to act on today's plan(s) without duplicating Calendar's
    // full planning UI — one line per still-planned/active entry.
    const plannedToday = plannedPairs.filter(p => App.queries.calendarEntryStatus(p) !== 'completed');
    let plannedHtml = '';
    if (plannedToday.length) {
      const sessions = await App.queries.getSessions();
      const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));
      plannedHtml = `
        <div class="section">
          <h2>Planned today</h2>
          ${plannedToday.map((pair) => {
            const session = pair.entry.sessionId ? sessionMap[pair.entry.sessionId] : null;
            const hex = App.sessionColors.hexFor(session ? session.color : null);
            const isActive = App.queries.calendarEntryStatus(pair) === 'active';
            return `
              <div class="list-row">
                <div class="list-row-title"><span class="color-dot color-dot-hollow" style="border-color:${hex}"></span>${App.utils.escapeHtml(session ? session.name : 'Workout')}</div>
                <button class="list-row-action" data-start-entry="${pair.entry.id}">${isActive ? 'Resume' : 'Start'}</button>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    let bodyHtml;
    if (todaysCompleted.length) {
      bodyHtml = (await Promise.all(todaysCompleted.map(w => completedWorkoutBlockHtml(w)))).join('');
    } else if (!activeWorkout) {
      bodyHtml = `
        <p class="empty-hint">No workouts logged yet</p>
        <button class="btn-primary" id="log-workout-btn">+ Log Workout</button>
      `;
    } else {
      bodyHtml = '';
    }

    container.innerHTML = `
      <div class="view-header">
        <h1>Today</h1>
        <p class="view-subhead">${App.utils.formatDateHeading(today)}</p>
      </div>
      ${bannerHtml}
      ${plannedHtml}
      <div class="section">
        <h2>Today's Workout</h2>
        ${bodyHtml}
      </div>
    `;

    const resumeBtn = container.querySelector('#resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', () => App.router.go('/workout/' + activeWorkout.id));

    const logBtn = container.querySelector('#log-workout-btn');
    if (logBtn) logBtn.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const workout = await App.commands.startWorkout('Workout', []);
      App.router.go('/workout/' + workout.id);
    });

    container.querySelectorAll('[data-view-workout]').forEach((btn) => {
      btn.addEventListener('click', () => App.router.go('/workout/' + btn.dataset.viewWorkout));
    });

    container.querySelectorAll('[data-start-entry]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const { workout } = await App.commands.startPlannedWorkout(btn.dataset.startEntry);
          App.router.go('/workout/' + workout.id);
        } catch (err) {
          if (err instanceof App.errors.ActiveWorkoutConflictError) {
            btn.disabled = false;
            alert(`You already have "${err.activeWorkout.title}" in progress. Finish or resume it before starting this workout.`);
            return;
          }
          if (err instanceof App.errors.MultipleActiveWorkoutsError) {
            alert('There\'s a data conflict with active workouts — resolve it below before starting this one.');
            App.router.render();
            return;
          }
          throw err;
        }
      });
    });
  };

  async function completedWorkoutBlockHtml(workout) {
    const sets = await App.queries.getSetsForWorkout(workout.id);
    const exercises = await App.queries.getExercises(true);
    const exerciseMap = Object.fromEntries(exercises.map(e => [e.id, e]));

    const lines = workout.exerciseOrder.map((exId) => {
      const ex = exerciseMap[exId];
      if (!ex) return '';
      const exSets = sets.filter(s => s.exerciseId === exId && App.commands.isSetCompleted(s));
      if (!exSets.length) return '';
      return `<div class="list-row-sub">${App.utils.escapeHtml(ex.name)}: ${exSets.map(s => s.weight + '×' + s.reps).join(', ')}</div>`;
    }).filter(Boolean).join('');

    return `
      <div class="list-row" style="flex-direction:column; align-items:stretch">
        <div style="display:flex; justify-content:space-between; align-items:baseline">
          <div class="list-row-title">${App.utils.escapeHtml(workout.title)}</div>
          <div class="list-row-sub">Completed ${App.utils.formatTime(workout.endedAt)}</div>
        </div>
        ${lines}
        <button class="list-row-action" data-view-workout="${workout.id}" style="padding-left:0; margin-top:8px">View Workout</button>
      </div>
    `;
  }
})();
