window.App = window.App || {};

// A small, fixed palette rather than a free-form picker — restrained,
// muted tones consistent with the rest of the UI (no neon/saturated
// colors). Used for the small Calendar dot indicators; the calendar
// itself stays mostly monochrome.
App.sessionColors = (function () {
  // Muted tones for small calendar/list indicators on a dark UI —
  // secondary only; the app's primary accent remains cyan.
  const PALETTE = [
    { key: 'red', label: 'Red', hex: '#B85A52' },
    { key: 'orange', label: 'Orange', hex: '#B8824A' },
    { key: 'yellow', label: 'Yellow', hex: '#A8943A' },
    { key: 'green', label: 'Green', hex: '#5A9A6A' },
    { key: 'teal', label: 'Teal', hex: '#4A9A94' },
    { key: 'blue', label: 'Blue', hex: '#5A7FB0' },
    { key: 'indigo', label: 'Indigo', hex: '#6B6FB0' },
    { key: 'purple', label: 'Purple', hex: '#8A6FB0' },
    { key: 'pink', label: 'Pink', hex: '#A86A85' },
    { key: 'gray', label: 'Gray', hex: '#7A8490' }
  ];
  const DEFAULT_COLOR = 'gray';
  const BY_KEY = Object.fromEntries(PALETTE.map(c => [c.key, c]));

  // Sessions created before this feature (or imported from an older
  // backup) may have no color, or an invalid one — always resolve to a
  // sensible default rather than letting an undefined color leak into
  // rendering.
  function normalize(color) {
    return BY_KEY[color] ? color : DEFAULT_COLOR;
  }

  function hexFor(color) {
    return BY_KEY[normalize(color)].hex;
  }

  return { PALETTE, DEFAULT_COLOR, normalize, hexFor };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.sessionColors;
