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
  assert.match(source, /manage-account\.html/);
  assert.match(source, /account\.phone_number/);
  assert.match(source, /Add another account/);
  assert.match(source, /grid\.append\(addAccountCard\(\)\)/);
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

test('dashboard recent messages are ownership scoped and received-only', () => {
  const route = read('../routes/messages.get.js');
  const dashboard = read('scripts/account_dashboard.js');
  const html = read('desktop/index.html');
  assert.match(route, /router\.get\('\/recent-received'/);
  assert.match(route, /ta\.user_id = \?/);
  assert.match(route, /m\.is_outgoing = FALSE/);
  assert.match(route, /LIMIT \? OFFSET \?/);
  assert.match(route, /req\.query\.limit/);
  assert.match(route, /req\.query\.offset/);
  for (const field of ['account_name', 'sender_name', 'channel_name', 'sent_at']) {
    assert.match(route, new RegExp(field));
  }
  assert.match(dashboard, /\/messages\/recent-received/);
  assert.match(html, /id="recentMessages"/);
});

test('worker and ingestion persist message direction', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', '..', 'telegram_worker.py'), 'utf8');
  const ingestion = read('../routes/messages.post.js');
  const migration = read('../mysql_db/migrations/008_message_direction.sql');
  assert.match(worker, /"is_outgoing": bool\(event\.out\)/);
  assert.match(ingestion, /is_outgoing/);
  assert.match(migration, /ADD COLUMN `is_outgoing` boolean/i);
});

test('desktop dashboard reserves user-focused navigation routes', () => {
  const html = read('desktop/index.html');
  for (const route of [
    '/desktop/all-messages.html',
    '/desktop/people.html',
    '/desktop/archive-channels.html',
    '/desktop/media-library.html',
    '/settings.html'
  ]) {
    assert.ok(html.includes(`href="${route}"`), `missing dashboard route ${route}`);
  }
  assert.doesNotMatch(html, />Archives</);
  assert.doesNotMatch(html, /Saved Filters/);
  assert.match(html, /Accounts &amp; Settings/);
});

test('all messages page loads 50 then paginates by 15 at the scroll boundary', () => {
  const html = read('desktop/all-messages.html');
  const source = read('scripts/all_messages.js');
  assert.match(html, /session_guard\.js/);
  assert.match(html, /desktop_sidebar\.js/);
  assert.match(html, /id="messageSearch"/);
  assert.match(html, /placeholder="Search messages…"/);
  assert.match(html, /id="openSidebar"/);
  assert.match(source, /firstLoad \? 50 : 15/);
  assert.match(source, /scroll\.allMessages/);
  assert.match(source, /pageBottom - 200/);
  assert.match(source, /offset \+= messages\.length/);
  assert.match(source, /\/messages\/recent-received\?limit=/);
  assert.match(source, /message_id/);
});

test('all messages search is ownership scoped and searches message and participant details', () => {
  const route = read('../routes/messages.get.js');
  assert.match(route, /router\.get\('\/search'/);
  assert.match(route, /ta\.id = m\.telegram_account_id AND ta\.user_id = \?/);
  for (const field of ['m.text', 's.name', 'peer.name', 'c.name', 's.phone', 'peer.phone', 'ta.phone_number']) {
    assert.match(route, new RegExp(`CONVERT\\(${field.replace('.', '\\.') } USING utf8mb4\\) COLLATE utf8mb4_unicode_ci LIKE`));
  }
  assert.match(route, /CONVERT\(\? USING utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.match(route, /BINARY peer\.external_sender_id = BINARY CAST\(m\.telegram_chat_id AS CHAR\)/);
  assert.match(route, /m\.is_outgoing/);
  assert.doesNotMatch(route.match(/router\.get\('\/search'[\s\S]*?router\.get\('\/recent-received'/)[0], /WHERE m\.is_outgoing = FALSE/);
});

test('all messages search runs on Enter, identifies direction, and paginates results', () => {
  const source = read('scripts/all_messages.js');
  assert.match(source, /event\.key !== 'Enter'/);
  assert.match(source, /runSearch\(\$\(this\)\.val\(\)\)/);
  assert.match(source, /\/messages\/search\?q=/);
  assert.match(source, /encodeURIComponent\(activeQuery\)/);
  assert.match(source, /firstLoad \? 50 : 15/);
  assert.match(source, /Outgoing/);
  assert.match(source, /Incoming/);
  assert.match(source, /peer_name/);
  assert.match(source, /peer_phone/);
  assert.match(source, /history\.pushState/);
  assert.match(source, /popstate/);
});

test('conversation links load and focus an ownership-scoped 25-message context on each side', () => {
  const route = read('../routes/messages.get.js');
  const api = read('scripts/messages_api.js');
  const helpers = read('scripts/message_handling_helpers.js');
  const dashboard = read('scripts/account_dashboard.js');
  assert.match(route, /messageContextForEntity/);
  assert.match(route, /ta\.id = m\.telegram_account_id AND ta\.user_id = \?/);
  assert.match(route, /ORDER BY m\.sent_at DESC, m\.id DESC LIMIT 25/);
  assert.match(route, /ORDER BY m\.sent_at ASC, m\.id ASC LIMIT 25/);
  assert.match(api, /getMessageContext/);
  assert.match(helpers, /id=\"message-\$\{numericMessageId\}\"/);
  assert.match(helpers, /scrollIntoView/);
  assert.match(dashboard, /searchParams\.set\('message_id'/);
  for (const page of ['desktop/sender.html', 'desktop/channels.html']) {
    const html = read(page);
    assert.match(html, /getQueryParam\("message_id"\)/);
    assert.match(html, /getMessageContext/);
    assert.match(html, /Helpers\.focusMessage/);
  }
});
