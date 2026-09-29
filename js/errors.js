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

// Thrown by any App.cloud operation that needs a working, signed-in
// Supabase client (backup, restore) when one isn't available — cloud
// isn't configured for this deployment, the Supabase SDK script didn't
// load, or no one is signed in. Callers surface this as a normal
// message; it never corrupts or touches local IndexedDB data.
class CloudUnavailableError extends Error {
  constructor(reason) {
    super(reason || 'Cloud backup is not available right now.');
    this.name = 'CloudUnavailableError';
  }
}

// Wraps a Supabase error encountered while backing up or restoring one
// specific store, so the Account screen can say what failed without the
// caller needing to know Postgres/Supabase error shapes.
class CloudSyncError extends Error {
  constructor(storeName, cause) {
    super(`Cloud backup failed while processing "${storeName}": ${(cause && cause.message) || cause}`);
    this.name = 'CloudSyncError';
    this.storeName = storeName;
    this.cause = cause;
  }
}

App.errors = {
  MultipleActiveWorkoutsError, ActiveWorkoutConflictError,
  CloudUnavailableError, CloudSyncError
};

if (typeof module !== 'undefined' && module.exports) module.exports = App.errors;
