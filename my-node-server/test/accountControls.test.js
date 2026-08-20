const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('account controls are authenticated, ownership scoped, and worker coordinated', () => {
  const source = read('routes/telegram-accounts.js');
  assert.match(source, /router\.use\(requireAuth\)/);
  assert.match(source, /router\.post\('\/:id\/reconnect'/);
  assert.match(source, /router\.post\('\/:id\/disconnect'/);
  assert.match(source, /controlAccount\('restart'/);
  assert.match(source, /controlAccount\('stop'/);
  assert.match(source, /WHERE id = \? AND user_id = \?/);
});

test('removing a connection preserves archive rows and clears only connection state', () => {
  const source = read('routes/telegram-accounts.js');
  assert.match(source, /router\.delete\('\/:id\/connection'/);
  assert.match(source, /session_ciphertext = NULL/);
  assert.match(source, /session_key_version = NULL/);
  assert.match(source, /connection_status = 'removed'/);
  assert.match(source, /archive_data_preserved: true/);
  assert.doesNotMatch(source, /DELETE FROM (messages|senders|channels|media|telegram_accounts)/i);
});

test('archive pause is persistent and blocks incoming messages before filters', () => {
  const route = read('routes/telegram-accounts.js');
  const filters = read('public/utils/filterRules.js');
  const migration = read('mysql_db/migrations/004_account_archive_controls.sql');
  assert.match(route, /router\.patch\('\/:id\/archive-enabled'/);
  assert.match(route, /typeof req\.body\?\.enabled !== 'boolean'/);
  assert.match(filters, /SELECT filters_enabled, archive_enabled/);
  assert.match(filters, /if \(!Boolean\(accountRows\[0\]\.archive_enabled\)\) return false/);
  assert.match(migration, /archive_enabled` boolean NOT NULL DEFAULT TRUE/i);
});

test('management UI exposes all implemented controls without secrets', () => {
  const html = read('public/manage-account.html');
  const source = read('public/scripts/manage_account.js');
  for (const id of ['reconnectAccount', 'disconnectAccount', 'toggleArchive', 'reauthenticateAccount', 'removeAccount']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /archive-enabled/);
  assert.match(source, /window\.confirm/);
  assert.doesNotMatch(source, /worker_secret|session_ciphertext|sessionStorage|localStorage/i);
});
