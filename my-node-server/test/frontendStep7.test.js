const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');
const read = relative => fs.readFileSync(path.join(publicRoot, relative), 'utf8');

test('desktop and mobile dashboards use the account hierarchy controller', () => {
  for (const page of ['desktop/index.html', 'mobile/index.html']) {
    const html = read(page);
    assert.match(html, /account_dashboard\.js/);
    assert.match(html, /id="accountGrid"/);
    assert.match(html, /id="senderList"/);
    assert.match(html, /id="channelList"/);
    assert.doesNotMatch(html, /socket_load_messages\.js/);
  }
});

test('account dashboard scopes entity requests and navigation by Telegram account', () => {
  const source = read('scripts/account_dashboard.js');
  assert.match(source, /\/api\/telegram-accounts/);
  assert.match(source, /\/messages\/entities/);
  assert.match(source, /telegram_account_id/);
  assert.match(source, /Manage — Coming soon/);
  assert.match(source, /Add another account/);
  assert.match(source, /grid\.append\(addAccountCard\(\)\)/);
  assert.match(source, /disabled/);
  assert.doesNotMatch(source, /session_ciphertext|api_hash|worker_secret/i);
});

test('message API and detail pages retain account context', () => {
  const api = read('scripts/messages_api.js');
  assert.match(api, /params\.set\('telegram_account_id'/);
  for (const page of ['desktop/sender.html', 'desktop/channels.html', 'mobile/sender.html', 'mobile/channels.html']) {
    const html = read(page);
    assert.match(html, /Helpers\.getQueryParam\("telegram_account_id"\)/);
    assert.match(html, /getMessagesBy(?:Sender|Channel)\([^\n]+accountId\)/);
  }
});
