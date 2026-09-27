window.App = window.App || {};
App.views = App.views || {};

(function () {
  App.views.more = async function (container) {
    const settings = await App.queries.getSettings();
    const exercises = (await App.queries.getExercises()).sort((a, b) => a.name.localeCompare(b.name));

    // Phase 6: cloud is entirely optional. `cloudClient` is null when
    // this deployment has no js/cloud/config.js values filled in, or the
    // Supabase SDK script didn't load (e.g. offline) — either way FitLog
    // itself is completely unaffected; only these two sections change.
    const cloudClient = App.cloud.getClient();
    const cloudUser = cloudClient ? App.cloud.auth.getUser() : null;

    container.innerHTML = `
      <div class="view-header"><h1>More</h1></div>

      <div class="section">
        <h2>Units</h2>
        <div class="segmented" id="unit-toggle">
          <button class="segmented-btn ${settings.unit === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
          <button class="segmented-btn ${settings.unit === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
        </div>
      </div>

      <div class="section">
        <h2>Bodyweight</h2>
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
              <div class="list-row-title">${App.utils.escapeHtml(e.name)}</div>
              <button class="list-row-action danger" data-archive="${e.id}">Archive</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-secondary" id="add-exercise-btn" style="margin-top:12px">+ Add Exercise</button>
      </div>

      <div class="section">
        <h2>Account</h2>
        ${!cloudClient ? `
          <p class="section-note">Cloud sync isn't set up for this deployment yet.</p>
        ` : !cloudUser ? `
          <p class="section-note">Sign in to back up your data to the cloud, or restore it on a new device.</p>
          <div class="modal-form" style="max-width:280px">
            <input type="email" id="auth-email" placeholder="Email" autocomplete="email">
            <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password">
          </div>
          <button class="btn-secondary" id="auth-signin-btn">Sign In</button>
          <button class="btn-secondary" id="auth-signup-btn">Create Account</button>
          <div id="auth-status"></div>
        ` : `
          <p class="section-note">Signed in as ${App.utils.escapeHtml(cloudUser.email || '')}</p>
          <button class="btn-secondary" id="auth-signout-btn">Sign Out</button>
        `}
      </div>

      ${cloudClient && cloudUser ? `
        <div class="section">
          <h2>Cloud</h2>
          <p class="section-note">Backing up never deletes anything already in the cloud — it only adds or updates your records there.</p>
          <button class="btn-secondary" id="cloud-backup-btn">Back Up Data</button>
          <button class="btn-secondary" id="cloud-restore-btn">Restore from Cloud</button>
          <div id="cloud-status"></div>
        </div>
      ` : ''}

      <div class="section">
        <h2>Data</h2>
        <p class="section-note">Everything is stored locally on this device only. Back up regularly.</p>
        <button class="btn-secondary" id="export-btn">Export Data</button>
        <button class="btn-secondary" id="import-btn">Import Data</button>
        <input type="file" id="import-file" accept="application/json" hidden>
        <button class="btn-danger" id="clear-btn">Clear All Data</button>
        <div id="import-errors"></div>
      </div>
    `;

    container.querySelectorAll('.segmented-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await App.commands.setUnit(btn.dataset.unit);
        App.views.more(container);
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
        App.views.more(container);
      });
    });

    container.querySelector('#add-exercise-btn').addEventListener('click', () => {
      const name = prompt('Exercise name');
      if (!name) return;
      App.commands.createExercise(name).then(() => App.views.more(container));
    });

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
        App.views.more(container);
      } catch (err) {
        const details = (err.details || []).slice(0, 6).map(d => `<div>${d}</div>`).join('');
        errorsEl.innerHTML = `<p class="section-note">Import rejected — nothing was changed.${details}</p>`;
      }
    });

    container.querySelector('#clear-btn').addEventListener('click', async () => {
      if (!confirm('Delete ALL data on this device? This cannot be undone. Export a backup first if you want to keep anything.')) return;
      await App.db.clearAll();
      await App.ensureSeed();
      alert('All data cleared.');
      App.views.more(container);
    });

    // ---- Phase 6: Account (sign up / sign in / sign out) ----
    const authStatusEl = container.querySelector('#auth-status');

    const signInBtn = container.querySelector('#auth-signin-btn');
    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        const email = container.querySelector('#auth-email').value.trim();
        const password = container.querySelector('#auth-password').value;
        if (!email || !password) {
          authStatusEl.innerHTML = '<p class="section-note">Enter an email and password.</p>';
          return;
        }
        try {
          await App.cloud.auth.signIn(email, password);
          App.views.more(container);
        } catch (err) {
          authStatusEl.innerHTML = `<p class="section-note">${App.utils.escapeHtml(err.message || 'Sign in failed.')}</p>`;
        }
      });
    }

    const signUpBtn = container.querySelector('#auth-signup-btn');
    if (signUpBtn) {
      signUpBtn.addEventListener('click', async () => {
        const email = container.querySelector('#auth-email').value.trim();
        const password = container.querySelector('#auth-password').value;
        if (!email || !password) {
          authStatusEl.innerHTML = '<p class="section-note">Enter an email and password.</p>';
          return;
        }
        try {
          const { confirmationRequired } = await App.cloud.auth.signUp(email, password);
          if (confirmationRequired) {
            authStatusEl.innerHTML = '<p class="section-note">Check your email to confirm your account, then sign in.</p>';
          } else {
            App.views.more(container);
          }
        } catch (err) {
          authStatusEl.innerHTML = `<p class="section-note">${App.utils.escapeHtml(err.message || 'Could not create account.')}</p>`;
        }
      });
    }

    const signOutBtn = container.querySelector('#auth-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await App.cloud.auth.signOut();
        App.views.more(container);
      });
    }

    // ---- Phase 6: Cloud backup / restore ----
    const cloudStatusEl = container.querySelector('#cloud-status');

    const backupBtn = container.querySelector('#cloud-backup-btn');
    if (backupBtn) {
      backupBtn.addEventListener('click', async () => {
        backupBtn.disabled = true;
        cloudStatusEl.innerHTML = '<p class="section-note">Backing up…</p>';
        try {
          const counts = await App.cloud.backup.backupAll();
          const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([store, n]) => `${n} ${store}`).join(', ');
          cloudStatusEl.innerHTML = `<p class="section-note">Backup complete${summary ? ' — ' + App.utils.escapeHtml(summary) : ''}.</p>`;
        } catch (err) {
          cloudStatusEl.innerHTML = `<p class="section-note">Backup failed — ${App.utils.escapeHtml(err.message || 'unknown error')}. Nothing on this device was changed.</p>`;
        } finally {
          backupBtn.disabled = false;
        }
      });
    }

    const restoreBtn = container.querySelector('#cloud-restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async () => {
        // Mirrors the existing file-import confirmation exactly: restore
        // can alter or replace data already on this device, so explicit
        // confirmation (and an explicit merge/replace choice) is always
        // required before it runs — never a silent overwrite.
        const replace = confirm(
          'Restore from Cloud?\n\nThis can overwrite data already on this device with the cloud version.\n\n' +
          'OK = replace everything on this device with the cloud backup\nCancel = merge cloud data with what\'s already here'
        );
        restoreBtn.disabled = true;
        cloudStatusEl.innerHTML = '<p class="section-note">Restoring…</p>';
        try {
          await App.cloud.restore.restoreAll(replace ? 'replace' : 'merge');
          alert('Restore complete.');
          App.views.more(container);
        } catch (err) {
          cloudStatusEl.innerHTML = `<p class="section-note">Restore failed — ${App.utils.escapeHtml(err.message || 'unknown error')}. Nothing on this device was changed.</p>`;
        } finally {
          restoreBtn.disabled = false;
        }
      });
    }
  };
})();
