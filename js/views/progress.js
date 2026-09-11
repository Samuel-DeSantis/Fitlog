window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.progress = async function (container) {
    container.innerHTML = `
      <div class="view-header"><h1>Progress</h1></div>
      <div class="placeholder-block">
        <strong>Coming in a later phase</strong>
        Exercise → metric → time range charts, built from your actual completed workouts.
      </div>
    `;
  };
})();
