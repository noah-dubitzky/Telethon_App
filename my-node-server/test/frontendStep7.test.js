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

test('people directory lists incoming direct and channel senders across owned accounts', () => {
  const route = read('../routes/messages.get.js');
  const peopleRoute = route.match(/router\.get\('\/senders'[\s\S]*?router\.get\('\/senders\/:externalId'/)[0];
  assert.match(peopleRoute, /ta\.id = s\.telegram_account_id AND ta\.user_id = \?/);
  assert.match(peopleRoute, /m\.sender_id = s\.id AND m\.telegram_account_id = s\.telegram_account_id/);
  assert.match(peopleRoute, /m\.is_outgoing = FALSE/);
  assert.doesNotMatch(peopleRoute, /m\.channel_id IS NULL/);
  assert.match(peopleRoute, /s\.telegram_account_id/);
  assert.match(peopleRoute, /MAX\(m\.sent_at\) AS latest_message_time/);
});

test('people page loads, filters, and links senders with Telegram account context', () => {
  const html = read('desktop/people.html');
  const source = read('scripts/people.js');
  assert.match(html, /session_guard\.js/);
  assert.match(html, /id="peopleSearch"/);
  assert.match(html, /id="peopleList"/);
  assert.match(html, /aria-current="page"/);
  assert.match(source, /\/messages\/senders/);
  assert.match(source, /telegram_account_id/);
  assert.match(source, /\/desktop\/sender\.html/);
  assert.match(source, /latest_message_time/);
  assert.match(source, /toLocaleLowerCase/);
});

test('channel directory route returns active channels across owned Telegram accounts', () => {
  const route = read('../routes/messages.get.js');
  const channelRoute = route.match(/router\.get\('\/channels'[\s\S]*?async function messagesForEntity/)[0];
  assert.match(channelRoute, /ta\.id = c\.telegram_account_id AND ta\.user_id = \?/);
  assert.match(channelRoute, /m\.channel_id = c\.id AND m\.telegram_account_id = c\.telegram_account_id/);
  assert.match(channelRoute, /m\.is_outgoing = FALSE/);
  assert.match(channelRoute, /c\.telegram_account_id/);
  assert.match(channelRoute, /MAX\(m\.sent_at\) AS latest_message_time/);
  assert.match(channelRoute, /COUNT\(m\.id\) AS message_count/);
});

test('channels page loads, filters, and links channels with Telegram account context', () => {
  const html = read('desktop/archive-channels.html');
  const source = read('scripts/archive_channels.js');
  assert.match(html, /session_guard\.js/);
  assert.match(html, /id="channelSearch"/);
  assert.match(html, /id="channelDirectory"/);
  assert.match(html, /aria-current="page"/);
  assert.match(source, /\/messages\/channels/);
  assert.match(source, /telegram_account_id/);
  assert.match(source, /\/desktop\/channels\.html/);
  assert.match(source, /latest_message_time/);
  assert.match(source, /message_count/);
  assert.match(source, /toLocaleLowerCase/);
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

test('desktop sender conversation uses Telegram-style directional message bubbles', () => {
  const route = read('../routes/messages.get.js');
  const html = read('desktop/sender.html');
  const helpers = read('scripts/message_handling_helpers.js');
  assert.match(route, /m\.is_outgoing/);
  assert.match(html, /bg-\[#dfe7ed\]/);
  assert.match(html, /id="download-messages"/);
  assert.match(html, /id="account-back-link"/);
  assert.match(html, /id="messages"/);
  assert.match(helpers, /const outgoing = msg\.is_outgoing/);
  assert.match(helpers, /justify-end/);
  assert.match(helpers, /justify-start/);
  assert.match(helpers, /bg-\[#d9fdd3\]/);
  assert.match(helpers, /Helpers\.cleanMediaPath/);
});

test('PDF export migration tracks conversation ownership and every included sender', () => {
  const migration = read('../mysql_db/migrations/009_pdf_exports.sql');
  const verification = read('../mysql_db/migrations/009_pdf_exports_verify.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `pdf_exports`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `pdf_export_senders`/);
  assert.match(migration, /information_schema`.`statistics/);
  assert.match(migration, /uk_telegram_accounts_id_user/);
  assert.match(migration, /uk_messages_account_internal/);
  assert.match(migration, /`conversation_type` enum\('direct','channel'\)/);
  assert.match(migration, /`telegram_chat_id` bigint NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(`telegram_account_id`, `user_id`\)/);
  assert.match(migration, /FOREIGN KEY \(`telegram_account_id`, `sender_id`\)/);
  assert.match(migration, /FOREIGN KEY \(`telegram_account_id`, `channel_id`\)/);
  assert.match(migration, /`sender_name_at_export`/);
  assert.match(migration, /PRIMARY KEY \(`pdf_export_id`, `sender_id`\)/);
  assert.match(verification, /pdf_export_sender_count/);
});

test('PDF export API creates, retrieves, and deletes only owned export metadata', () => {
  const route = read('../routes/pdf.exports.js');
  const server = read('../server.js');
  assert.match(route, /router\.use\(requireAuth\)/);
  assert.match(route, /router\.get\('\/'/);
  assert.match(route, /router\.get\('\/:id'/);
  assert.match(route, /router\.post\('\/'/);
  assert.match(route, /router\.delete\('\/:id'/);
  assert.match(route, /WHERE pe\.user_id = \?/);
  assert.match(route, /DELETE FROM pdf_exports WHERE id = \? AND user_id = \?/);
  assert.match(route, /SELECT id FROM telegram_accounts WHERE id = \? AND user_id = \?/);
  assert.match(route, /Exported sender counts must equal the PDF message count/);
  assert.match(route, /beginTransaction/);
  assert.match(route, /INSERT INTO pdf_export_senders/);
  assert.doesNotMatch(route, /storage_key: row\.storage_key/);
  assert.match(server, /app\.use\('\/api\/pdf-exports', pdfExportsRouter\)/);
});
