const test = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/setup');

test('escapeHtml neutralizes all five special characters', () => {
  const App = freshApp();
  assert.equal(App.utils.escapeHtml(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(App.utils.escapeHtml(`"><img src=x onerror=alert(1)>`), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(App.utils.escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});

test('escapeHtml handles null/undefined without throwing', () => {
  const App = freshApp();
  assert.equal(App.utils.escapeHtml(null), '');
  assert.equal(App.utils.escapeHtml(undefined), '');
});
