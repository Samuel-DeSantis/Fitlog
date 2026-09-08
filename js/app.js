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
    App.router.init();
  }

  boot();
})();
