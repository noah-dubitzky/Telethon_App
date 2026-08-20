const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('management endpoints require session ownership and expose aggregate counts', () => {
  const source = read('routes/telegram-accounts.js');
  assert.match(source, /router\.use\(requireAuth\)/);
  assert.match(source, /router\.get\('\/:id\/management'/);
  assert.match(source, /router\.patch\('\/:id\/filters-enabled'/);
  assert.match(source, /WHERE id = \? AND user_id = \?/);
  assert.match(source, /COUNT\(\*\).*sender_filters/s);
  assert.match(source, /COUNT\(\*\).*channel_filters/s);
  const safeColumns = source.match(/const SAFE_ACCOUNT_COLUMNS = `[\s\S]*?`;/)?.[0] || '';
  assert.doesNotMatch(safeColumns, /session_ciphertext|session_key_version|worker_assignment/);
});

test('filter toggle requires a real boolean', () => {
  const source = read('routes/telegram-accounts.js');
  assert.match(source, /typeof req\.body\?\.enabled !== 'boolean'/);
  assert.match(source, /filters_enabled = \?/);
});

test('worker filter decision bypasses rules when account filtering is disabled', () => {
  const source = read('public/utils/filterRules.js');
  assert.match(source, /SELECT filters_enabled(?:, archive_enabled)? FROM telegram_accounts/);
  assert.match(source, /if \(!Boolean\(accountRows\[0\]\.filters_enabled\)\) return true/);
});

test('Step 8 migration defaults existing and new accounts to filtering enabled', () => {
  const migration = read('mysql_db/migrations/003_account_filter_toggle.sql');
  assert.match(migration, /ADD COLUMN `filters_enabled` boolean NOT NULL DEFAULT TRUE/i);
});
