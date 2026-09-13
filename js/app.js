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

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    await App.router.init();
  }

  App._bootPromise = boot();
})();
