window.App = window.App || {};

App.utils = (function () {
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Local calendar date as YYYY-MM-DD. Deliberately NOT toISOString(),
  // which reports UTC and mislabels the date near midnight for anyone
  // outside UTC.
  function localISOFromDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayLocalISO() {
    return localISOFromDate(new Date());
  }

  function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return localISOFromDate(d);
  }

  // Full timestamp — fine for createdAt/updatedAt (exact instants), just
  // never used for calendar-date comparisons.
  function nowISO() {
    return new Date().toISOString();
  }

  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function estimate1RM(weight, reps) {
    if (!weight || !reps) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  function sparklinePath(values, width, height, pad) {
    pad = pad == null ? 6 : pad;
    const clean = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (clean.length < 2) return '';
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = (max - min) || 1;
    const step = (width - pad * 2) / (clean.length - 1);
    return clean.map((v, i) => {
      const x = pad + i * step;
      const y = pad + (height - pad * 2) * (1 - (v - min) / range);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  return {
    uuid, todayLocalISO, daysAgoISO, nowISO, localISOFromDate,
    formatDateLabel, estimate1RM, sparklinePath, debounce, el
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.utils;
