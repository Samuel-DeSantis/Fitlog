(function () {
  App.router.register('/today', App.views.today);
  App.router.register('/train', App.views.train);
  App.router.register('/workout', App.views.workout);
  App.router.register('/calendar', App.views.calendar);
  App.router.register('/progress', App.views.progress);
  App.router.register('/more', App.views.more);

  document.querySelectorAll('.nav-tab[data-route]').forEach((tab) => {
    tab.addEventListener('click', () => App.router.go(tab.dataset.route));
  });

  async function boot() {
    await App.db.open();
    await App.ensureSeed();

    // Safety net: if a true race ever produces more than one active
    // workout, fold the extras into completed ones without losing any
    // logged sets, and say so.
    const { resolvedCount } = await App.commands.consolidateActiveWorkouts();
    if (resolvedCount > 0) {
      alert(`Found ${resolvedCount} duplicate in-progress workout${resolvedCount === 1 ? '' : 's'}. Kept the most recent one active and marked the rest completed — nothing logged was deleted.`);
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    App.router.init();
  }

  boot();
})();
