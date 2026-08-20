const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');
const read = relative => fs.readFileSync(path.join(publicRoot, relative), 'utf8');

test('Manage card action is distinct from the archive action', () => {
  const source = read('scripts/account_dashboard.js');
  assert.match(source, /searchParams\.set\('telegram_account_id', account\.id\)/);
  assert.match(source, /new URL\('\/manage-account\.html'/);
  assert.match(source, /\.text\('Manage'\)/);
});

test('Manage page consumes Step 8 APIs and renders source-of-truth counts', () => {
  const html = read('manage-account.html');
  const source = read('scripts/manage_account.js');
  assert.match(html, /session_guard\.js/);
  assert.match(source, /\/management/);
  assert.match(source, /\/filters-enabled/);
  for (const id of ['allowedSenders', 'blockedSenders', 'allowedChannels', 'blockedChannels']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(source, /localStorage|sessionStorage|session_ciphertext|worker_secret/i);
  assert.doesNotMatch(source, /["']user_id["']\s*:/i);
});

test('filter toggle waits for server and restores its prior state on failure', () => {
  const source = read('scripts/manage_account.js');
  assert.match(source, /toggle\.prop\('disabled', true\)/);
  assert.match(source, /updateFilterState\(data\.filters_enabled\)/);
  assert.match(source, /updateFilterState\(previousState\)/);
  assert.match(source, /toggle\.prop\('disabled', false\)/);
});

test('existing advanced filter page retains Telegram account context', () => {
  const source = read('scripts/filters.js');
  assert.match(source, /get\('telegram_account_id'\)/);
  assert.match(source, /\/api\/filters\?\$\{accountQuery\(\)\}/);
  assert.match(source, /\/api\/filters\/channel\/\$\{channelId\}\?\$\{accountQuery\(\)\}/);
  assert.match(source, /\/api\/filters\/sender\/\$\{senderId\}\?\$\{accountQuery\(\)\}/);
  assert.match(source, /\/manage-account\.html\?telegram_account_id=/);
});
