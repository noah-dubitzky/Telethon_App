(function () {
  'use strict';
  const form = document.getElementById('storageSettingsForm');
  const fields = document.getElementById('storageSettingsFields');
  const status = document.getElementById('storageSettingsStatus');
  const retry = document.getElementById('retryStorageSettings');
  const flags = ['save_text', 'save_photos', 'save_videos', 'save_audio', 'save_files', 'save_pdfs'];
  let loaded = false;
  let busy = false;
  function display(settings) {
    flags.forEach(key => { form.elements[key].checked = settings[key]; });
    form.elements.max_file_size_mb.value = settings.max_file_size_mb ?? '';
  }
  async function request(options) {
    const response = await fetch('/api/storage/settings', { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!response.ok) throw new Error('Unable to access storage settings');
    return (await response.json()).settings;
  }
  async function load() {
    if (busy) return;
    busy = true;
    retry.classList.add('hidden');
    status.textContent = 'Loading storage settings…';
    try {
      display(await request());
      loaded = true;
      fields.disabled = false;
      status.textContent = 'Your current preferences are shown below.';
    } catch (_) {
      status.textContent = 'Unable to load storage settings. Please try again.';
      retry.classList.remove('hidden');
    } finally { busy = false; }
  }
  form.addEventListener('input', () => {
    if (loaded && !busy) status.textContent = 'You have unsaved changes.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !loaded || !form.reportValidity()) return;
    const settings = Object.fromEntries(flags.map(key => [key, form.elements[key].checked]));
    settings.max_file_size_mb = form.elements.max_file_size_mb.value === '' ? null : Number(form.elements.max_file_size_mb.value);
    busy = true;
    fields.disabled = true;
    status.textContent = 'Saving storage settings…';
    try {
      display(await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }));
      status.textContent = 'Storage settings saved. They apply to future automatic saves.';
    } catch (_) { status.textContent = 'Unable to save settings. Your changes are still here; please try again.'; }
    finally { fields.disabled = false; busy = false; }
  });
  retry.addEventListener('click', load);
  document.addEventListener('settings:tab', event => {
    if (event.detail === 'storageTab' && !loaded) load();
  });
})();
