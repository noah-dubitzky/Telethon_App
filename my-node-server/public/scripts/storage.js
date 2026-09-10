(function () {
  'use strict';
  const button = document.getElementById('refreshStorage');
  const status = document.getElementById('storageStatus');
  const results = document.getElementById('storageResults');
  let busy = false;
  let loadedAt = 0;

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
    return `${(bytes / (1000 ** index)).toLocaleString(undefined, { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
  }

  async function load(force) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    results.setAttribute('aria-busy', 'true');
    status.textContent = 'Calculating storage…';
    try {
      const response = await fetch('/api/storage' + (force ? '?refresh=1' : ''), { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Storage request failed');
      const data = await response.json();
      document.getElementById('storageTotal').textContent = formatBytes(data.total_bytes);
      [['Text', data.text_bytes], ['Media', data.media_bytes], ['Pdf', data.pdf_bytes]].forEach(([name, bytes]) => {
        const percent = data.total_bytes ? bytes / data.total_bytes * 100 : 0;
        const percentage = percent > 0 && percent < 0.1 ? '<0.1' : percent.toFixed(1);
        document.getElementById('storage' + name).textContent = `${formatBytes(bytes)} · ${percentage}%`;
        document.getElementById('storage' + name + 'Bar').style.width = percent + '%';
      });
      loadedAt = Date.now();
      results.classList.remove('hidden');
      status.textContent = `${data.total_bytes === 0 ? 'No saved content yet. ' : ''}Last updated ${new Date(data.updated_at).toLocaleString()}`;
    } catch (_) {
      status.textContent = loadedAt ? 'Unable to refresh storage. Previous totals are shown. Try Refresh again.' : 'Unable to calculate storage. Try Refresh again.';
    } finally {
      busy = false;
      button.disabled = false;
      results.setAttribute('aria-busy', 'false');
    }
  }
  button.addEventListener('click', () => load(true));
  document.addEventListener('settings:tab', event => {
    if (event.detail === 'storageTab' && Date.now() - loadedAt >= 60000) load(false);
  });
})();
