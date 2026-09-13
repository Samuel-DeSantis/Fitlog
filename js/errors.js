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

App.errors = { MultipleActiveWorkoutsError };

if (typeof module !== 'undefined' && module.exports) module.exports = App.errors;
