(function () {
  App.router.register('/today', App.views.today);
  App.router.register('/train', App.views.train);
  App.router.register('/progress', App.views.progress);
  App.router.register('/more', App.views.more);

  document.querySelectorAll('.nav-tab[data-route]').forEach((tab) => {
    tab.addEventListener('click', () => App.router.go(tab.dataset.route));
  });

  document.getElementById('fab-log').addEventListener('click', () => App.quickLog.open());

  async function boot() {
    await App.db.open();
    await App.ensureSeed();

    // One-time cleanup for anyone who hit the pre-fix duplicate-workout
    // race: collapses extra in_progress workouts into completed ones
    // without touching any logged sets.
    const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
    if (resolvedCount > 0) {
      alert(`Found ${resolvedCount} duplicate in-progress workout${resolvedCount === 1 ? '' : 's'} from before this was fixed. Kept your most recent one active and marked the rest completed — nothing logged was deleted.`);
    }

    // Best-effort durability hint — Chrome/Firefox are less likely to evict
    // IndexedDB under storage pressure once a site is "persistent." This is
    // not a substitute for JSON backups; it just reduces silent data loss.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    App.router.init();
  }

  boot();
})();
