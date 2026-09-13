const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, reopenApp } = require('./helpers/setup');

test('9. A future plan creates a Calendar Entry, not a completed Workout', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const future = App.utils.daysAgoISO(-7);

  const entry = await App.commands.planCalendarEntry(future, session.id);
  assert.equal(entry.date, future);
  assert.equal(entry.workoutId, null);
  assert.equal((await App.queries.getAllCompletedWorkouts()).length, 0, 'planning must not create any workout');
});

test('10 & calendarEntryStatus: a plan with no linked workout reads as planned', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  await App.commands.planCalendarEntry('2026-09-18', session.id);

  const [pair] = await App.queries.getCalendarEntriesWithWorkouts('2026-09-18', '2026-09-18');
  assert.equal(App.queries.calendarEntryStatus(pair), 'planned');
});

test('11 & 12. Starting a planned entry creates the Workout once and never duplicates it on repeat calls', async () => {
  const App = freshApp();
  const bench = await App.commands.createExercise('Bench Press');
  const session = await App.commands.createSession('Upper Body', [bench.id], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);

  const first = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(first.workout.status, 'active');
  assert.equal(first.workout.sessionId, session.id);
  assert.deepEqual(first.workout.exerciseOrder, [bench.id]);
  assert.equal(first.workout.date, '2026-09-18', "the workout is dated to the plan's date");

  const second = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(second.workout.id, first.workout.id, 'must resume the same workout, not create another');

  const allWorkouts = await App.db.getAll('workouts');
  assert.equal(allWorkouts.length, 1);

  const reloadedEntry = await App.queries.getCalendarEntry(entry.id);
  assert.equal(reloadedEntry.workoutId, first.workout.id, 'the entry is linked to the workout it started');
});

test('13 & 14. Completing the Workout flips the occurrence to completed, never before finishing', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);
  const { workout } = await App.commands.startPlannedWorkout(entry.id);

  let [pair] = await App.queries.getCalendarEntriesWithWorkouts('2026-09-18', '2026-09-18');
  assert.equal(App.queries.calendarEntryStatus(pair), 'active', 'must not read as completed while still active');

  await App.commands.finishWorkout(workout.id);

  [pair] = await App.queries.getCalendarEntriesWithWorkouts('2026-09-18', '2026-09-18');
  assert.equal(App.queries.calendarEntryStatus(pair), 'completed');
});

test('BUGFIX: starting a plan while an unrelated workout is active is refused, not silently attached', async () => {
  const App = freshApp();
  const other = await App.commands.startWorkout('Some Other Workout', []);
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);

  await assert.rejects(
    () => App.commands.startPlannedWorkout(entry.id),
    (err) => err instanceof App.errors.ActiveWorkoutConflictError && err.activeWorkout.id === other.id
  );

  const reloadedEntry = await App.queries.getCalendarEntry(entry.id);
  assert.equal(reloadedEntry.workoutId, null, 'the plan must NOT be attached to the unrelated active workout');

  const activeRows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(activeRows.length, 1, 'no second active workout should have been created');
  assert.equal(activeRows[0].id, other.id);
});

test('BUGFIX: two different planned entries — starting the second while the first is active is refused', async () => {
  const App = freshApp();
  const sessionA = await App.commands.createSession('Upper Body', [], 'red');
  const sessionB = await App.commands.createSession('Lower Body', [], 'blue');
  const entryA = await App.commands.planCalendarEntry('2026-09-18', sessionA.id);
  const entryB = await App.commands.planCalendarEntry('2026-09-19', sessionB.id);

  const { workout: workoutA } = await App.commands.startPlannedWorkout(entryA.id);
  assert.equal(workoutA.status, 'active');

  await assert.rejects(
    () => App.commands.startPlannedWorkout(entryB.id),
    (err) => err instanceof App.errors.ActiveWorkoutConflictError && err.activeWorkout.id === workoutA.id
  );

  const reloadedA = await App.queries.getCalendarEntry(entryA.id);
  const reloadedB = await App.queries.getCalendarEntry(entryB.id);
  assert.equal(reloadedA.workoutId, workoutA.id, "entry A keeps its own workout's link");
  assert.equal(reloadedB.workoutId, null, 'entry B must remain unlinked');

  // Finishing A frees up the active slot, so B can now start normally.
  await App.commands.finishWorkout(workoutA.id);
  const { workout: workoutB } = await App.commands.startPlannedWorkout(entryB.id);
  assert.equal(workoutB.status, 'active');
  assert.notEqual(workoutB.id, workoutA.id);
});

test('BUGFIX: concurrent start attempts on the SAME entry still resolve to one workout (no regression)', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);

  const results = await Promise.all(
    Array.from({ length: 5 }, () => App.commands.startPlannedWorkout(entry.id))
  );
  const ids = new Set(results.map(r => r.workout.id));
  assert.equal(ids.size, 1, 'every concurrent call on the same entry must resolve to the SAME workout');

  const activeRows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(activeRows.length, 1);
});

test('BUGFIX: concurrent start attempts on TWO DIFFERENT entries — exactly one succeeds, the other is refused', async () => {
  const App = freshApp();
  const sessionA = await App.commands.createSession('Upper Body', [], 'red');
  const sessionB = await App.commands.createSession('Lower Body', [], 'blue');
  const entryA = await App.commands.planCalendarEntry('2026-09-18', sessionA.id);
  const entryB = await App.commands.planCalendarEntry('2026-09-19', sessionB.id);

  const results = await Promise.allSettled([
    App.commands.startPlannedWorkout(entryA.id),
    App.commands.startPlannedWorkout(entryB.id)
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent starts should succeed');
  assert.equal(rejected.length, 1, 'the other must be refused, not silently merged');
  assert.ok(rejected[0].reason instanceof App.errors.ActiveWorkoutConflictError);

  const activeRows = (await App.db.getAll('workouts')).filter(w => w.status === 'active');
  assert.equal(activeRows.length, 1, 'only one workout should have been created across both attempts');

  // Whichever entry lost the race must remain completely unlinked.
  const reloadedA = await App.queries.getCalendarEntry(entryA.id);
  const reloadedB = await App.queries.getCalendarEntry(entryB.id);
  const linkedCount = [reloadedA, reloadedB].filter(e => e.workoutId).length;
  assert.equal(linkedCount, 1, 'exactly one entry should have gotten linked');
});

test('deleting a planned Calendar Entry does not delete the Session', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);

  await App.commands.deleteCalendarEntry(entry.id);

  assert.equal(await App.queries.getCalendarEntry(entry.id), undefined);
  assert.ok(await App.queries.getSession(session.id), 'the Session must survive deleting a plan built from it');
});

test('deleting a completed Workout does not delete the Session it originated from', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const workout = await App.commands.startFromSession(session);
  await App.commands.finishWorkout(workout.id);

  await App.commands.deleteWorkout(workout.id);

  assert.ok(await App.queries.getSession(session.id));
});

test('if a linked workout is deleted, the entry gracefully reverts to "planned" and can be restarted', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);
  const { workout } = await App.commands.startPlannedWorkout(entry.id);

  await App.commands.deleteWorkout(workout.id);

  const [pair] = await App.queries.getCalendarEntriesWithWorkouts('2026-09-18', '2026-09-18');
  assert.equal(App.queries.calendarEntryStatus(pair), 'planned', 'a dangling link falls back to planned, not an error');

  const restarted = await App.commands.startPlannedWorkout(entry.id);
  assert.notEqual(restarted.workout.id, workout.id, 'restarting creates a fresh workout since the old one is gone');
});

test('5. Multiple workouts on the same date are supported', async () => {
  const App = freshApp();
  const w1 = await App.commands.createWorkout({ title: 'Morning', date: '2026-09-18', exerciseIds: [] });
  await App.commands.finishWorkout(w1.id);
  const w2 = await App.commands.createWorkout({ title: 'Evening', date: '2026-09-18', exerciseIds: [] });
  await App.commands.finishWorkout(w2.id);

  const completed = await App.queries.getCompletedWorkoutsInRange('2026-09-18', '2026-09-18');
  assert.equal(completed.length, 2);
});

test('19. Multiple planned entries on one date, plus a completed workout, all coexist', async () => {
  const App = freshApp();
  const upper = await App.commands.createSession('Upper Body', [], 'red');
  const lower = await App.commands.createSession('Lower Body', [], 'blue');
  await App.commands.planCalendarEntry('2026-09-18', upper.id);
  await App.commands.planCalendarEntry('2026-09-18', lower.id);
  const w = await App.commands.createWorkout({ title: 'Extra', date: '2026-09-18', exerciseIds: [] });
  await App.commands.finishWorkout(w.id);

  const entries = await App.queries.getCalendarEntriesInRange('2026-09-18', '2026-09-18');
  const completed = await App.queries.getCompletedWorkoutsInRange('2026-09-18', '2026-09-18');
  assert.equal(entries.length, 2);
  assert.equal(completed.length, 1);
});

test('15-18. Backfilling a past workout: create, date persists, editable, deletable', async () => {
  let App = freshApp();
  const pastDate = App.utils.daysAgoISO(10);
  const workout = await App.commands.createWorkout({ title: 'Forgot to log this', date: pastDate, exerciseIds: [] });
  await App.commands.finishWorkout(workout.id);

  App = reopenApp();
  let reloaded = await App.queries.getWorkout(workout.id);
  assert.equal(reloaded.date, pastDate, '16. historical date persists across reload');
  assert.equal(reloaded.status, 'completed');

  await App.commands.editWorkoutMeta(workout.id, { title: 'Backfilled Leg Day' });
  reloaded = await App.queries.getWorkout(workout.id);
  assert.equal(reloaded.title, 'Backfilled Leg Day', '17. historical workout can be edited');

  await App.commands.deleteWorkout(workout.id);
  assert.equal(await App.queries.getWorkout(workout.id), undefined, '18. historical workout can be deleted');
});

test('backfillWorkout creates a completed historical workout without touching an existing active workout', async () => {
  const App = freshApp();
  const active = await App.commands.startWorkout('Today Session', []);

  const pastDate = App.utils.daysAgoISO(3);
  const backfilled = await App.commands.backfillWorkout(pastDate, null);

  assert.equal(backfilled.status, 'completed');
  assert.equal(backfilled.date, pastDate);

  const stillActive = await App.queries.getActiveWorkout();
  assert.equal(stillActive.id, active.id, 'the existing active workout must be unaffected');
});

test('BUGFIX: editing a linked Workout\'s date moves its Calendar Entry to the new date', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);
  const { workout } = await App.commands.startPlannedWorkout(entry.id);
  assert.equal(workout.date, '2026-09-18');

  await App.commands.editWorkoutMeta(workout.id, { date: '2026-09-20' });

  const reloadedEntry = await App.queries.getCalendarEntry(entry.id);
  assert.equal(reloadedEntry.date, '2026-09-20', 'the plan must move to the workout\'s new date');

  const oldDateEntries = await App.queries.getCalendarEntriesInRange('2026-09-18', '2026-09-18');
  const newDateEntries = await App.queries.getCalendarEntriesInRange('2026-09-20', '2026-09-20');
  assert.equal(oldDateEntries.length, 0, 'no longer found on the old date');
  assert.equal(newDateEntries.length, 1, 'now found on the new date');
  assert.equal(newDateEntries[0].id, entry.id);
});

test('BUGFIX: editing a linked Workout\'s title only does not move its Calendar Entry', async () => {
  const App = freshApp();
  const session = await App.commands.createSession('Upper Body', [], 'red');
  const entry = await App.commands.planCalendarEntry('2026-09-18', session.id);
  await App.commands.startPlannedWorkout(entry.id);

  await App.commands.editWorkoutMeta(entry.workoutId || (await App.queries.getCalendarEntry(entry.id)).workoutId, { title: 'Renamed' });

  const reloadedEntry = await App.queries.getCalendarEntry(entry.id);
  assert.equal(reloadedEntry.date, '2026-09-18', 'a title-only edit must not touch the plan\'s date');
});

test('BUGFIX: editing the date of a workout with NO linked Calendar Entry works normally (no crash)', async () => {
  const App = freshApp();
  const workout = await App.commands.createWorkout({ title: 'Blank Workout', date: '2026-09-18', exerciseIds: [] });

  const updated = await App.commands.editWorkoutMeta(workout.id, { date: '2026-09-25' });
  assert.equal(updated.date, '2026-09-25');
});
