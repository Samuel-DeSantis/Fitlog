window.App = window.App || {};

// A distinct, catchable error rather than a silent repair. Thrown by
// queries.getActiveWorkout() if data integrity is ever violated (e.g. a
// hand-edited or pre-fix imported backup contains more than one active
// workout). The caller decides how to surface it — nothing is deleted or
// changed just by detecting this.
class MultipleActiveWorkoutsError extends Error {
  constructor(workouts) {
    super(`Found ${workouts.length} active workouts; there should be at most one.`);
    this.name = 'MultipleActiveWorkoutsError';
    this.workouts = workouts;
  }
}

// Thrown when trying to start a planned Calendar Entry that has no
// workout of its own yet, while a DIFFERENT workout is already active.
// The plan must never be silently attached to that unrelated workout —
// the caller has to finish/resume it first.
class ActiveWorkoutConflictError extends Error {
  constructor(activeWorkout) {
    super('Another workout is already active. Finish or resume it before starting this one.');
    this.name = 'ActiveWorkoutConflictError';
    this.activeWorkout = activeWorkout;
  }
}

App.errors = { MultipleActiveWorkoutsError, ActiveWorkoutConflictError };

if (typeof module !== 'undefined' && module.exports) module.exports = App.errors;
