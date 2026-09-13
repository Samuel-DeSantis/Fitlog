window.App = window.App || {};

// A small, fixed palette rather than a free-form picker — restrained,
// muted tones consistent with the rest of the UI (no neon/saturated
// colors). Used for the small Calendar dot indicators; the calendar
// itself stays mostly monochrome.
App.sessionColors = (function () {
  const PALETTE = [
    { key: 'red', label: 'Red', hex: '#C4483C' },
    { key: 'orange', label: 'Orange', hex: '#C97A3B' },
    { key: 'yellow', label: 'Yellow', hex: '#B99A2E' },
    { key: 'green', label: 'Green', hex: '#4C8B5D' },
    { key: 'teal', label: 'Teal', hex: '#3B8F8A' },
    { key: 'blue', label: 'Blue', hex: '#3D6EA5' },
    { key: 'indigo', label: 'Indigo', hex: '#5B5FA8' },
    { key: 'purple', label: 'Purple', hex: '#8B5FA8' },
    { key: 'pink', label: 'Pink', hex: '#B8567B' },
    { key: 'gray', label: 'Gray', hex: '#7A7F87' }
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
