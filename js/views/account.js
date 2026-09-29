window.App = window.App || {};
App.views = App.views || {};

// Account: the fifth tab. Home for authentication, cloud backup/restore,
// local data management, exercises, units and app info.
//
// FitLog never requires an account. Everything except the account/cloud
// sections works identically signed in or out; the cloud sections are
// purely additive (explicit Back Up / Restore only — no automatic sync,
// that is Phase 6.5).
(function () {
  const MIN_PASSWORD_LENGTH = 8;

  // Which auth form (if any) the signed-out screen is showing. Module
  // state rather than DOM state so it survives the re-renders below.
  let authMode = null; // null | 'signin' | 'create'

  function validateCredentials(email, password, mode) {
    if (!email || !password) return 'Enter an email and password.';
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.';
    if (mode === 'create' && password.length < MIN_PASSWORD_LENGTH) {
      return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return null;
  }

  App.views.account = async function (container) {
    const settings = await App.queries.getSettings();
    const exercises = (await App.queries.getExercises()).sort((a, b) => a.name.localeCompare(b.name));

    // `cloudClient` is null when this deployment has no cloud config or
    // the Supabase SDK didn't load (e.g. offline). FitLog itself is
    // unaffected either way.
    const cloudClient = App.cloud.getClient();
    const cloudUser = cloudClient ? App.cloud.auth.getUser() : null;
    if (cloudUser) authMode = null;

    const esc = App.utils.escapeHtml;

    const accountHtml = !cloudClient ? `
      <div class="view-header"><h1>Account</h1></div>
      <div class="section">
        <h2>Cloud features unavailable</h2>
        <p class="section-note">This version of FitLog is running in local-only mode. Your workouts are stored on this device.</p>
      </div>
    ` : cloudUser ? `
      <div class="view-header"><h1>Account</h1><p class="view-subhead">${esc(cloudUser.email || '')}</p></div>
      <div class="section">
        <h2>Cloud</h2>
        <p class="section-note"><span aria-hidden="true">✓</span> Connected — your FitLog account is connected.</p>
        <p class="section-note">Backing up never deletes anything already in the cloud — it only adds or updates your records there.</p>
        <button class="btn-secondary" id="cloud-backup-btn">Back Up Data</button>
        <button class="btn-secondary" id="cloud-restore-btn">Restore from Cloud</button>
        <div id="cloud-status"></div>
      </div>
    ` : `
      <div class="view-header"><h1>Account</h1></div>
      <div class="section">
        <h2>You're using FitLog locally</h2>
        <p class="section-note">Your workouts are stored on this device. You don't need an account to use FitLog.</p>
      </div>
      <div class="section">
        <h2>Create a free account</h2>
        <p class="section-note">Back up your training data and use FitLog across devices.</p>
        ${authMode === 'create' ? '' : '<button class="btn-primary" id="auth-show-create-btn">Create Account</button>'}
        <h2 style="margin-top:20px">Sign in</h2>
        <p class="section-note">Already have a FitLog account?</p>
        ${authMode === 'signin' ? '' : '<button class="btn-secondary" id="auth-show-signin-btn">Sign In</button>'}
        ${authMode ? `
          <div class="modal-form" style="max-width:280px;margin-top:12px">
            <input type="email" id="auth-email" placeholder="Email" autocomplete="email">
            <input type="password" id="auth-password" placeholder="Password" autocomplete="${authMode === 'create' ? 'new-password' : 'current-password'}">
          </div>
          ${authMode === 'create' ? `<p class="section-note">Your account lets you access your FitLog data on other devices. Passwords need at least ${MIN_PASSWORD_LENGTH} characters.</p>` : ''}
          <button class="btn-primary" id="auth-submit-btn">${authMode === 'create' ? 'Create Account' : 'Sign In'}</button>
          <button class="btn-text" id="auth-cancel-btn">Cancel</button>
          <div id="auth-status"></div>
        ` : ''}
      </div>
    `;

    container.innerHTML = `
      ${accountHtml}

      <div class="section">
        <h2>${cloudUser ? 'Training' : 'App'}</h2>
        <h3>Units</h3>
        <div class="segmented" id="unit-toggle">
          <button class="segmented-btn ${settings.unit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
          <button class="segmented-btn ${settings.unit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        </div>
        <h3 style="margin-top:16px">Bodyweight</h3>
        <div class="modal-form" style="max-width:220px">
          <input type="number" inputmode="decimal" id="bodyweight-input" step="0.1" value="${settings.bodyweight != null ? settings.bodyweight : ''}" placeholder="e.g. 175">
        </div>
        <p class="section-note">Current value only — not a tracking history yet.</p>
      </div>

      <div class="section">
        <h2>Exercises</h2>
        <div id="exercise-list">
          ${exercises.map(e => `
            <div class="list-row">
              <div class="list-row-title">${esc(e.name)}</div>
              <button class="list-row-action danger" data-archive="${e.id}">Archive</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-secondary" id="add-exercise-btn" style="margin-top:12px">+ Add Exercise</button>
      </div>

      <div class="section">
        <h2>${cloudUser ? 'Data' : 'Local Data'}</h2>
        <p class="section-note">${cloudUser ? 'Export a file copy of your data, or import one.' : 'Everything is stored locally on this device only. Export regularly.'}</p>
        <button class="btn-secondary" id="export-btn">Export Data</button>
        <button class="btn-secondary" id="import-btn">Import Data</button>
        <input type="file" id="import-file" accept="application/json" hidden>
        <button class="btn-danger" id="clear-btn">Clear All Data</button>
        <div id="import-errors"></div>
      </div>

      <div class="section">
        <h2>About FitLog</h2>
        <p class="section-note">A local-first workout tracker. Your training data lives on your device; an account is optional and only adds cloud backup.</p>
      </div>

      ${cloudUser ? `
        <div class="section">
          <h2>Account</h2>
          <button class="btn-secondary" id="auth-signout-btn">Sign Out</button>
        </div>
      ` : ''}
    `;

    const rerender = () => App.views.account(container);

    // ---- Units / bodyweight / exercises ----
    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await App.commands.setUnit(btn.dataset.unit);
        rerender();
      });
    });

    const bwInput = container.querySelector('#bodyweight-input');
    bwInput.addEventListener('change', async () => {
      const value = bwInput.value !== '' ? parseFloat(bwInput.value) : null;
      await App.commands.setBodyweight(value);
    });

    container.querySelectorAll('[data-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archive this exercise? Past workouts using it are unaffected — it just won\'t appear when adding new exercises.')) return;
        await App.commands.archiveExercise(btn.dataset.archive);
        rerender();
      });
    });

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      const name = prompt('Exercise name');
      if (!name) return;
      App.commands.createExercise(name).then(rerender);
    });

    // ---- Local export / import / clear ----
    container.querySelector('#export-btn').addEventListener('click', async () => {
      const data = await App.db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fitlog-backup-' + App.utils.todayLocalISO() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const fileInput = container.querySelector('#import-file');
    const errorsEl = container.querySelector('#import-errors');
    container.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      errorsEl.innerHTML = '';
      const file = fileInput.files[0];
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (e) {
        errorsEl.innerHTML = '<p class="section-note">That file is not valid JSON.</p>';
        return;
      }
      const replace = confirm('Import and replace all existing data?\n\nOK = replace everything\nCancel = merge with existing data');
      try {
        await App.db.importAll(data, replace ? 'replace' : 'merge');
        alert('Import complete.');
        rerender();
      } catch (err) {
        const details = (err.details || []).slice(0, 6).map(d => `<div>${esc(d)}</div>`).join('');
        errorsEl.innerHTML = `<p class="section-note">Import rejected — nothing was changed.${details}</p>`;
      }
    });

    container.querySelector('#clear-btn').addEventListener('click', async () => {
      if (!confirm('Delete ALL data on this device? This cannot be undone. Export a backup first if you want to keep anything.')) return;
      await App.db.clearAll();
      await App.ensureSeed();
      alert('All data cleared.');
      rerender();
    });

    // ---- Account: sign up / sign in / sign out ----
    const authStatusEl = container.querySelector('#auth-status');
    const showStatus = (msg) => { if (authStatusEl) authStatusEl.innerHTML = `<p class="section-note">${esc(msg)}</p>`; };

    const showCreate = container.querySelector('#auth-show-create-btn');
    if (showCreate) showCreate.addEventListener('click', () => { authMode = 'create'; rerender(); });
    const showSignIn = container.querySelector('#auth-show-signin-btn');
    if (showSignIn) showSignIn.addEventListener('click', () => { authMode = 'signin'; rerender(); });
    const cancelBtn = container.querySelector('#auth-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { authMode = null; rerender(); });

    const submitBtn = container.querySelector('#auth-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const email = container.querySelector('#auth-email').value.trim();
        const password = container.querySelector('#auth-password').value;
        const invalid = validateCredentials(email, password, authMode);
        if (invalid) { showStatus(invalid); return; }
        submitBtn.disabled = true;
        try {
          if (authMode === 'create') {
            const { confirmationRequired } = await App.cloud.auth.signUp(email, password);
            if (confirmationRequired) {
              showStatus('Check your email to confirm your account, then sign in.');
              return;
            }
          } else {
            await App.cloud.auth.signIn(email, password);
          }
          authMode = null;
          rerender();
        } catch (err) {
          showStatus(err.message || (authMode === 'create' ? 'Could not create account.' : 'Sign in failed.'));
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    const signOutBtn = container.querySelector('#auth-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        try {
          await App.cloud.auth.signOut();
        } catch (err) { /* local data is untouched either way */ }
        rerender();
      });
    }

    // ---- Cloud backup / restore ----
    const cloudStatusEl = container.querySelector('#cloud-status');

    const backupBtn = container.querySelector('#cloud-backup-btn');
    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        backupBtn.disabled = true;
        cloudStatusEl.innerHTML = '<p class="section-note">Backing up…</p>';
        try {
          const counts = await App.cloud.backup.backupAll();
          const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([store, n]) => `${n} ${store}`).join(', ');
          cloudStatusEl.innerHTML = `<p class="section-note">Backup complete${summary ? ' — ' + esc(summary) : ''}.</p>`;
        } catch (err) {
          cloudStatusEl.innerHTML = `<p class="section-note">Backup failed — ${esc(err.message || 'unknown error')}. Nothing on this device was changed.</p>`;
        } finally {
          backupBtn.disabled = false;
        }
      });
    }

    const restoreBtn = container.querySelector('#cloud-restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async () => {
        // Restore can alter or replace data already on this device, so
        // explicit confirmation (and an explicit merge/replace choice)
        // is always required — never a silent overwrite.
        const replace = confirm(
          'Restore from Cloud?\n\nThis can overwrite data already on this device with the cloud version.\n\n' +
          'OK = replace everything on this device with the cloud backup\nCancel = merge cloud data with what\'s already here'
        );
        restoreBtn.disabled = true;
        cloudStatusEl.innerHTML = '<p class="section-note">Restoring…</p>';
        try {
          await App.cloud.restore.restoreAll(replace ? 'replace' : 'merge');
          alert('Restore complete.');
          rerender();
        } catch (err) {
          cloudStatusEl.innerHTML = `<p class="section-note">Restore failed — ${esc(err.message || 'unknown error')}. Nothing on this device was changed.</p>`;
        } finally {
          restoreBtn.disabled = false;
        }
      });
    }
  };
})();
