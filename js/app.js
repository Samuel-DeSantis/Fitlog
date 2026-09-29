(function () {
  App.router.register('/today', App.views.today);
  App.router.register('/train', App.views.train);
  App.router.register('/workout', App.views.workout);
  App.router.register('/calendar', App.views.calendar);
  App.router.register('/progress', App.views.progress);
  App.router.register('/account', App.views.account);

  document.querySelectorAll('.nav-tab[data-route]').forEach((tab) => {
    tab.addEventListener('click', () => App.router.go(tab.dataset.route));
  });

  async function boot() {
    await App.db.open();
    await App.ensureSeed();

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // Cloud auth is best-effort and must never block local use: if
    // Supabase isn't configured (see js/cloud/config.js), the SDK
    // script didn't load, or the network is unavailable, the app boots
    // exactly as it always has, fully usable while signed out.
    try {
      await App.cloud.auth.init();
    } catch (e) {
      // swallow — local-first behavior is unaffected either way.
    }

    await App.router.init();
  }

  App._bootPromise = boot();
})();
