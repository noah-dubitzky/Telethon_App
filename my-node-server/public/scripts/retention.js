(function () {
  'use strict';
  const form = document.getElementById('retentionForm');
  const fields = document.getElementById('retentionFields');
  const status = document.getElementById('retentionStatus');
  const retry = document.getElementById('retryRetention');
  const dialog = document.getElementById('retentionDialog');
  const keys = ['text', 'media', 'pdf'];
  let loaded = false;
  let busy = false;
  let confirmation = null;
  async function request(path = '', options = {}) {
    const response = await fetch('/api/retention' + path, { credentials: 'same-origin', cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to access retention settings.');
    return data;
  }
  function customControl(key) {
    const input = document.getElementById(key + 'RetentionCustom');
    const custom = form.elements[key + '_retention_days'].value === 'custom';
    input.classList.toggle('hidden', !custom);
    input.disabled = !custom;
    input.required = custom;
  }
  function display(settings) {
    keys.forEach(key => {
      const value = settings[key + '_retention_days'];
      const select = form.elements[key + '_retention_days'];
      select.value = value == null ? '' : [30, 90, 365].includes(value) ? String(value) : 'custom';
      document.getElementById(key + 'RetentionCustom').value = value ?? '';
      customControl(key);
    });
  }
  async function load() {
    if (busy) return;
    busy = true;
    retry.classList.add('hidden');
    status.textContent = 'Loading retention settings…';
    try {
      display((await request()).settings);
      loaded = true;
      fields.disabled = false;
      status.textContent = 'Forever keeps content until you remove it.';
    } catch (error) {
      status.textContent = error.message;
      retry.classList.remove('hidden');
    } finally { busy = false; }
  }
  function confirmPreview(data) {
    document.getElementById('retentionTextCount').textContent = data.counts.text.toLocaleString();
    document.getElementById('retentionMediaCount').textContent = data.counts.media.toLocaleString();
    document.getElementById('retentionPdfCount').textContent = data.counts.pdfs.toLocaleString();
    dialog.showModal();
    document.getElementById('cancelRetention').focus();
    return new Promise(resolve => { confirmation = resolve; });
  }
  function resolveConfirmation(value) {
    dialog.close();
    if (confirmation) { confirmation(value); confirmation = null; }
  }
  document.getElementById('cancelRetention').addEventListener('click', () => resolveConfirmation(false));
  document.getElementById('confirmRetention').addEventListener('click', () => resolveConfirmation(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); resolveConfirmation(false); });
  keys.forEach(key => form.elements[key + '_retention_days'].addEventListener('change', () => customControl(key)));
  form.addEventListener('input', () => { if (!busy) status.textContent = 'You have unsaved retention changes.'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !loaded || !form.reportValidity()) return;
    const settings = Object.fromEntries(keys.map(key => {
      const value = form.elements[key + '_retention_days'].value;
      return [key + '_retention_days', value === '' ? null : Number(value === 'custom' ? document.getElementById(key + 'RetentionCustom').value : value)];
    }));
    busy = true;
    fields.disabled = true;
    status.textContent = 'Checking retention changes…';
    try {
      const preview = await request('/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (preview.confirmation_required && !await confirmPreview(preview)) {
        status.textContent = 'Retention changes were not saved.';
        return;
      }
      display((await request('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, confirmation_token: preview.token }) })).settings);
      status.textContent = 'Retention settings saved.';
    } catch (error) { status.textContent = error.message + ' Your changes have not been saved.'; }
    finally { fields.disabled = false; busy = false; }
  });
  retry.addEventListener('click', load);
  document.addEventListener('settings:tab', event => { if (event.detail === 'storageTab' && !loaded) load(); });
})();
