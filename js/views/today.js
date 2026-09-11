window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.today = async function (container) {
    const today = App.utils.todayLocalISO();
    const [activeWorkout, todaysCompleted] = await Promise.all([
      App.queries.getActiveWorkout(),
      App.queries.getCompletedWorkoutsInRange(today, today)
    ]);

    let bannerHtml = '';
    if (activeWorkout) {
      const notFromToday = activeWorkout.date !== today;
      bannerHtml = `
        <div class="active-banner">
          <div class="active-banner-label">Workout in progress</div>
          <div class="active-banner-title">${activeWorkout.title}</div>
          ${notFromToday ? `<div class="section-note" style="margin:2px 0 0">Started ${App.utils.formatDateLabel(activeWorkout.date)}</div>` : ''}
          <button class="btn-primary" id="resume-btn">Resume Workout</button>
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
      return `<div class="list-row-sub">${ex.name}: ${exSets.map(s => s.weight + '×' + s.reps).join(', ')}</div>`;
    }).filter(Boolean).join('');

    return `
      <div class="list-row" style="flex-direction:column; align-items:stretch">
        <div style="display:flex; justify-content:space-between; align-items:baseline">
          <div class="list-row-title">${workout.title}</div>
          <div class="list-row-sub">Completed ${App.utils.formatTime(workout.endedAt)}</div>
        </div>
        ${lines}
        <button class="list-row-action" data-view-workout="${workout.id}" style="padding-left:0; margin-top:8px">View Workout</button>
      </div>
    `;
  }
})();
