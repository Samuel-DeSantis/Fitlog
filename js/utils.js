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

  // Compact "Weekday · Mon Day" form (e.g. "Sun · Sep 14"), used where a
  // single day's heading needs to be short rather than fully spelled out.
  // Built the same local-time-safe way as formatDateHeading/formatDateLabel
  // above — parsing dateStr with an explicit T00:00:00 keeps this on the
  // LOCAL calendar date rather than shifting a day via UTC interpretation.
  function formatDateCompact(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${weekday} · ${monthDay}`;
  }

  // All month math below uses the new Date(year, month, day) constructor,
  // which is ALWAYS local-time — never toISOString()/UTC — consistent
  // with localISOFromDate() above. This is what keeps month navigation
  // and day-in-month indexing correct across timezones and DST changes.
  function daysInMonth(year, month0) {
    return new Date(year, month0 + 1, 0).getDate();
  }

  function formatMonthHeading(year, month0) {
    return new Date(year, month0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  // 0 (Sunday) - 6 (Saturday), local time.
  function firstWeekdayOfMonth(year, month0) {
    return new Date(year, month0, 1).getDay();
  }

  function addMonthsLocal(year, month0, delta) {
    const d = new Date(year, month0 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function dateAtLocal(year, month0, day) {
    return localISOFromDate(new Date(year, month0, day));
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

  // Every place a user-entered string (exercise/session names, workout
  // titles, notes) is interpolated into an innerHTML template must run
  // through this first — both as text content and inside quoted
  // attributes, since we consistently use double quotes for attributes.
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    uuid, todayLocalISO, daysAgoISO, nowISO, localISOFromDate,
    formatDateLabel, formatDateHeading, formatDateCompact, formatTime, estimate1RM, debounce, el, escapeHtml,
    daysInMonth, formatMonthHeading, firstWeekdayOfMonth, addMonthsLocal, dateAtLocal
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = App.utils;
