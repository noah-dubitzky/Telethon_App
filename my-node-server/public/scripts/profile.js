(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  let currentUser = null;
  let editMode = null;
  let saving = false;
  let lastTrigger = null;
  const dialog = byId('profileDialog');

  async function api(path, method = 'GET', body) {
    const response = await fetch('/api/auth' + path, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 401) {
      window.location.replace('/');
      throw new Error('Please sign in again.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to save changes. Please try again.');
    return data;
  }

  function notice(text) {
    byId('profileNotice').textContent = text;
    byId('profileNotice').classList.remove('hidden');
  }

  function renderPending(pending) {
    byId('pendingEmail').classList.toggle('hidden', !pending);
    byId('pendingEmailText').textContent = pending
      ? `Enter the code sent to ${pending.new_email}. Codes expire after 15 minutes. Your current email remains active until verification succeeds.` : '';
  }

  async function loadEmailState() {
    try {
      const state = await api('/profile');
      byId('emailAvailability').textContent = state.email_change_available ? 'Verify your new address before it becomes your login email.' : 'Email changes are temporarily unavailable.';
      document.querySelector('[data-profile-edit="email"]').disabled = !state.email_change_available;
      renderPending(state.pending_email);
    } catch (_) {
      byId('emailAvailability').textContent = 'Unable to check email verification availability. Try again shortly.';
    }
  }

  function renderDate(id, value, unixSeconds) {
    const element = document.getElementById(id);
    const raw = String(value || '').replace(' ', 'T');
    const date = unixSeconds != null
      ? new Date(Number(unixSeconds) * 1000)
      : new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + 'Z');
    if (!value || Number.isNaN(date.getTime())) {
      element.textContent = 'Not available';
      element.removeAttribute('datetime');
      return;
    }
    element.dateTime = date.toISOString();
    element.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long', timeStyle: 'long'
    }).format(date);
  }

  function renderProfile(user) {
    currentUser = user;
    window.telesaverUser = user;
    byId('profileName').textContent = user.display_name || 'Not set';
    document.querySelectorAll('[data-user-initial]').forEach(function (element) {
      element.textContent = (user.display_name || user.email || '?').trim().charAt(0).toUpperCase();
    });
    document.querySelectorAll('[data-user-email]').forEach(function (element) {
      element.textContent = user.email || 'Not available';
    });
    document.getElementById('profileId').textContent = user.id ?? 'Not available';
    document.getElementById('profileStatus').textContent = user.status || 'Not available';
    renderDate('profileCreated', user.created_at, user.created_at_unix);
    renderDate('profileUpdated', user.updated_at, user.updated_at_unix);
    document.getElementById('profileDetails').classList.remove('hidden');
    document.getElementById('profileTimezone').classList.remove('hidden');
  }

  async function loadProfile(force = false) {
    const loading = document.getElementById('profileLoading');
    const error = document.getElementById('profileError');
    loading.classList.remove('hidden');
    error.classList.add('hidden');
    try {
      let user = force ? null : window.telesaverUser;
      if (!user) {
        const response = await fetch('/api/auth/me', {
          credentials: 'same-origin', headers: { Accept: 'application/json' }
        });
        if (response.status === 401) {
          window.location.replace('/');
          return;
        }
        if (!response.ok) throw new Error('Profile unavailable');
        user = (await response.json()).user;
      }
      if (!user) throw new Error('Profile unavailable');
      renderProfile(user);
    } catch (_) {
      error.classList.remove('hidden');
    } finally {
      loading.classList.add('hidden');
    }
  }

  const editors = {
    name: { title: 'Edit display name', help: 'Choose the name shown on your TeleSaver profile.', button: 'Save name', path: '/profile/name', method: 'PATCH', fields: [['display_name', 'Display name', 'text', 'nickname']] },
    email: { title: 'Change login email', help: 'Enter your current TeleSaver password. We will send an eight-digit verification code to your new email address.', button: 'Send verification code', path: '/profile/email', fields: [['new_email', 'New email address', 'email', 'email'], ['current_password', 'Current password', 'password', 'current-password']] },
    password: { title: 'Change password', help: 'Use at least 12 characters. Other login sessions will be signed out and pending email changes will be cancelled.', button: 'Update password', path: '/profile/password', fields: [['current_password', 'Current password', 'password', 'current-password'], ['new_password', 'New password', 'password', 'new-password'], ['confirm_password', 'Confirm new password', 'password', 'new-password']] },
    verify: { title: 'Verify your new email', help: 'Enter the eight-digit code from your email. This will update your login email and sign out other sessions.', button: 'Verify and change email', path: '/profile/email/verify', fields: [['code', 'Verification code', 'text', 'one-time-code']] }
  };

  function openEditor(mode, trigger) {
    if (saving) return;
    editMode = mode;
    lastTrigger = trigger;
    const editor = editors[mode];
    byId('profileEditForm').reset();
    byId('profileDialogTitle').textContent = editor.title;
    byId('profileEditHelp').textContent = editor.help;
    byId('saveProfileEdit').textContent = editor.button;
    byId('profileEditError').classList.add('hidden');
    byId('profileEditFields').replaceChildren();
    editor.fields.forEach(([name, labelText, type, autocomplete]) => {
      const label = document.createElement('label');
      label.className = 'block text-sm font-medium';
      label.textContent = labelText;
      const input = document.createElement('input');
      Object.assign(input, { name, type, autocomplete, required: true });
      input.className = 'mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200';
      input.setAttribute('aria-describedby', 'profileEditError');
      if (name === 'display_name') { input.maxLength = 100; input.value = currentUser?.display_name || ''; }
      if (name === 'new_email') input.maxLength = 320;
      if (name === 'new_password' || name === 'confirm_password') input.minLength = 12;
      if (name === 'code') { input.inputMode = 'numeric'; input.pattern = '[0-9]{8}'; input.maxLength = 8; }
      label.append(input);
      byId('profileEditFields').append(label);
    });
    dialog.showModal();
    byId('profileEditFields').querySelector('input').focus();
  }

  function closeEditor() { if (!saving) dialog.close(); }
  byId('closeProfileDialog').addEventListener('click', closeEditor);
  byId('cancelProfileEdit').addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    byId('profileEditForm').reset();
    byId('profileEditFields').replaceChildren();
    lastTrigger?.focus();
  });
  document.querySelectorAll('[data-profile-edit]').forEach(button => {
    button.addEventListener('click', () => openEditor(button.dataset.profileEdit, button));
  });
  byId('verifyEmailButton').addEventListener('click', event => openEditor('verify', event.currentTarget));
  byId('cancelEmailButton').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { const result = await api('/profile/email', 'DELETE', {}); renderPending(null); notice(result.message); }
    catch (error) { notice(error.message); }
    finally { button.disabled = false; }
  });
  byId('profileEditForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const editor = editors[editMode];
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const errorBox = byId('profileEditError');
    errorBox.classList.add('hidden');
    if (editMode === 'password' && values.new_password !== values.confirm_password) {
      errorBox.textContent = 'The new passwords do not match.';
      errorBox.classList.remove('hidden');
      return;
    }
    saving = true;
    dialog.querySelectorAll('input, button').forEach(element => { element.disabled = true; });
    byId('saveProfileEdit').textContent = 'Saving...';
    try {
      const result = await api(editor.path, editor.method || 'POST', values);
      if (result.sign_in_required) { window.location.replace('/'); return; }
      dialog.close();
      notice(result.message + (result.notification_failed ? ' We could not deliver the notification to your previous email address.' : ''));
      if (editMode === 'email') renderPending(result.pending_email);
      else {
        if (editMode === 'verify' || editMode === 'password') renderPending(null);
        await loadProfile(true);
      }
    } catch (error) {
      errorBox.textContent = error.message || 'Unable to save changes. Please try again.';
      errorBox.classList.remove('hidden');
    } finally {
      saving = false;
      dialog.querySelectorAll('input, button').forEach(element => { element.disabled = false; });
      dialog.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
      byId('saveProfileEdit').textContent = editor.button;
    }
  });

  document.getElementById('retryProfile').addEventListener('click', () => { loadProfile(true); loadEmailState(); });
  loadProfile();
  loadEmailState();
})();
