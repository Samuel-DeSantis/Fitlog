window.App = window.App || {};

App.router = (function () {
  const routes = {};

  function register(path, handler) {
    routes[path] = handler;
  }

  function parse() {
    const hash = location.hash.slice(1) || '/today';
    const segments = hash.split('/').filter(Boolean);
    const path = '/' + (segments[0] || 'today');
    return { path, parts: segments.slice(1) };
  }

  async function render() {
    const { path, parts } = parse();
    const handler = routes[path] || routes['/today'];

    document.querySelectorAll('.nav-tab[data-route]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.route === path);
    });

    // Scopes the Calendar's gentle scroll-snap (see styles.css) to only
    // the Calendar route, since it's implemented as document-level
    // scroll-snap-type and would otherwise apply page scrolling on every
    // other view too.
    document.documentElement.classList.toggle('route-calendar', path === '/calendar');

    const content = document.getElementById('app-content');
    await handler(content, parts);
    content.scrollTop = 0;
  }

  async function init() {
    window.addEventListener('hashchange', render);
    await render();
  }

  function go(path) {
    if (location.hash.slice(1) === path) {
      render();
    } else {
      location.hash = path;
    }
  }

  return { register, init, render, go };
})();
