window.App = window.App || {};

// A Session's exercises[] entries can each carry an optional training
// prescription — targetSets / repMin / repMax. This is deliberately kept
// separate from two other things it could be confused with:
//  - the Exercise definition itself (an Exercise has no prescription —
//    "3x5-8" describes what THIS session intends, not a property of
//    Bench Press in general);
//  - an actual logged Workout Set (a Session is "what I intend to do";
//    a Set is "what I actually did" — see commands.js's addSet/updateSet
//    for that side. A prescription must never constrain, pre-fill, or be
//    copied into a Set; Phase 4.3 will decide how a prescription informs
//    starting a Workout, but nothing here reaches into Workouts/Sets).
//
// Every entry is normalized to one consistent shape so callers never have
// to branch on whether a session predates this feature (Phase 4.0 and
// earlier stored exercises as bare exerciseId strings):
//   { exerciseId, targetSets, repMin, repMax }
// targetSets/repMin/repMax are null when no prescription has been set —
// true for every exercise today, since nothing yet writes a non-null one
// (Phase 4.2 adds the editor UI for that). null always means
// "unspecified", never "zero".
App.prescriptions = (function () {
  function isPositiveInteger(n) {
    return typeof n === 'number' && Number.isInteger(n) && n > 0;
  }

  // Rejects invalid values rather than silently clamping/repairing them —
  // matching the app's existing convention (see errors.js and db.js's
  // import validation) of surfacing bad input explicitly instead of
  // guessing at a fix. Any field left null/undefined is fine: a
  // prescription can be partially set (e.g. targetSets without a rep
  // range yet), or not set at all.
  function validate(fields) {
    const targetSets = fields.targetSets;
    const repMin = fields.repMin;
    const repMax = fields.repMax;
    if (targetSets != null && !isPositiveInteger(targetSets)) {
      throw new Error('targetSets must be a positive integer.');
    }
    if (repMin != null && !isPositiveInteger(repMin)) {
      throw new Error('repMin must be a positive integer.');
    }
    if (repMax != null && !isPositiveInteger(repMax)) {
      throw new Error('repMax must be a positive integer.');
    }
    if (repMin != null && repMax != null && repMax < repMin) {
      throw new Error('repMax must be greater than or equal to repMin.');
    }
  }

  // Accepts either a bare exerciseId string (every session exercise
  // before this feature, and still how the Session editor adds one
  // today — Phase 4.2 adds prescription editing) or a full/partial
  // {exerciseId, targetSets, repMin, repMax} object. Either way, returns
  // the complete canonical shape with unset fields as null. Throws on a
  // missing exerciseId or an invalid prescription value — callers that
  // need import-style leniency instead should use normalizeEntryLenient.
  function normalizeEntry(entry) {
    if (typeof entry === 'string') {
      return { exerciseId: entry, targetSets: null, repMin: null, repMax: null };
    }
    if (!entry || typeof entry !== 'object' || !entry.exerciseId) {
      throw new Error('Each session exercise needs an exerciseId.');
    }
    const fields = {
      targetSets: entry.targetSets != null ? entry.targetSets : null,
      repMin: entry.repMin != null ? entry.repMin : null,
      repMax: entry.repMax != null ? entry.repMax : null
    };
    validate(fields);
    return { exerciseId: entry.exerciseId, ...fields };
  }

  function normalizeList(entries) {
    return (entries || []).map(normalizeEntry);
  }

  // Same shape normalization, but never throws: an invalid prescription
  // becomes "no prescription" (null fields) rather than rejecting the
  // entry outright. Used only for restoring an imported backup, where
  // one malformed value in one session shouldn't block recovering the
  // rest of a person's data; every other caller (the Session editor's
  // save, or any direct API use) should use the strict normalizeEntry so
  // bad input is caught immediately instead of being silently discarded.
  function normalizeEntryLenient(entry) {
    try {
      return normalizeEntry(entry);
    } catch (e) {
      const exerciseId = typeof entry === 'string' ? entry : (entry && entry.exerciseId);
      return { exerciseId, targetSets: null, repMin: null, repMax: null };
    }
  }

  function normalizeListLenient(entries) {
    return (entries || []).map(normalizeEntryLenient);
  }

  // Merges an incoming exercises[] array (what updateSession's `exercises`
  // field receives) against a Session's EXISTING exercises, so supplying
  // a bare exerciseId string — the legacy/backward-compatible shape —
  // for an exercise that already has a prescription can never silently
  // reset it to null. Rules:
  //  - existing exercise + bare ID           -> keep its existing prescription
  //  - existing exercise + structured object -> use exactly what's supplied
  //    (not merged with the old prescription — an explicit object is a
  //    deliberate, complete replacement, unlike updateSessionExercisePrescription's
  //    partial-field merge, which is a different, narrower operation)
  //  - new exercise + bare ID                -> null prescription (the
  //    established default for an unprescribed exercise)
  //  - new exercise + structured object      -> use exactly what's supplied
  //  - an existing exercise absent from `incoming` is simply not carried
  //    over — the same as any other removal
  // Order always follows `incoming`.
  function mergeList(existingExercises, incoming) {
    const existingByExerciseId = Object.fromEntries(
      normalizeList(existingExercises).map(e => [e.exerciseId, e])
    );
    return (incoming || []).map((entry) => {
      if (typeof entry === 'string') {
        return existingByExerciseId[entry] || normalizeEntry(entry);
      }
      return normalizeEntry(entry);
    });
  }

  return { validate, normalizeEntry, normalizeList, normalizeEntryLenient, normalizeListLenient, mergeList };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.prescriptions;
