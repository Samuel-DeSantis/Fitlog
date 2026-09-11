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

  // Local calendar date as YYYY-MM-DD. Deliberately not toISOString(),
  // which reports UTC and mislabels the date near midnight for anyone
  // outside UTC. This is the one function everything else builds on for
  // "what day is it".
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

  // Exact instant — fine for startedAt/endedAt/createdAt, never used for
  // calendar-date comparisons.
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

  function formatDateHeading(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function estimate1RM(weight, reps) {
    if (!weight || !reps) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
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
    formatDateLabel, formatDateHeading, formatTime, estimate1RM, debounce, el
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.utils;
