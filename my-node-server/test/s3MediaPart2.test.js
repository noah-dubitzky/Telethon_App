const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertOwnedKey, safeDownloadName } = require('../services/s3Media');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('S3 key validation permits only the database-owned user/account prefix', () => {
  assert.doesNotThrow(() => assertOwnedKey(
    'users/14/telegram_accounts/27/images/100_56.jpg', 14, 27
  ));
  assert.throws(() => assertOwnedKey(
    'users/15/telegram_accounts/27/images/100_56.jpg', 14, 27
  ), /ownership/);
  assert.throws(() => assertOwnedKey(
    'users/14/telegram_accounts/28/images/100_56.jpg', 14, 27
  ), /ownership/);
});

test('presigned download names cannot inject headers or paths', () => {
  assert.equal(safeDownloadName('../../report\r\n".pdf'), '.._.._report_.pdf');
  assert.equal(safeDownloadName(''), 'download');
  assert.ok(safeDownloadName('x'.repeat(300)).length <= 180);
});

test('media lifecycle routes require authentication and ownership joins', () => {
  const source = read('routes/media.s3.js');
  assert.match(source, /router\.use\(requireAuth\)/);
  assert.match(source, /JOIN telegram_accounts ta ON ta\.id = m\.telegram_account_id/);
  assert.match(source, /WHERE md\.id = \? AND ta\.user_id = \?/);
  assert.match(source, /router\.get\('\/:id\/access'/);
  assert.match(source, /router\.get\('\/:id\/content'/);
  assert.match(source, /router\.patch\('\/:id'/);
  assert.match(source, /router\.delete\('\/:id'/);
});

test('media library listing is ownership scoped, typed, and paginated', () => {
  const source = read('routes/media.s3.js');
  const listing = source.slice(source.indexOf("router.get('/',"), source.indexOf('const OWNED_MEDIA_SQL'));
  assert.match(listing, /ta\.id = m\.telegram_account_id AND ta\.user_id = \?/);
  assert.match(listing, /md\.media_type IN/);
  assert.match(listing, /ORDER BY m\.sent_at DESC, md\.id DESC/);
  assert.match(listing, /LIMIT \? OFFSET \?/);
  assert.match(listing, /has_more/);
  assert.doesNotMatch(listing, /md\.s3_key/);
});

test('media library UI uses protected content URLs and account-aware message links', () => {
  const html = read('public/desktop/media-library.html');
  const source = read('public/scripts/media_library.js');
  assert.match(html, /session_guard\.js/);
  assert.match(html, /id="mediaTabs"/);
  assert.match(html, /id="mediaGrid"/);
  assert.match(source, /\/api\/media\?type=/);
  assert.match(source, /firstLoad \? 50 : 25/);
  assert.match(source, /scroll\.mediaLibrary/);
  assert.match(source, /distanceFromBottom <= 8/);
  assert.doesNotMatch(html, /id="loadMoreMedia"/);
  assert.match(source, /\/api\/media\/\$\{encodeURIComponent\(item\.media_id\)\}\/content/);
  assert.match(source, /telegram_account_id/);
  assert.match(source, /message_id/);
  assert.match(source, /Open conversation/);
  assert.match(source, /peer_id/);
  assert.match(source, /peer_external_sender_id/);
});

test('deletion locks metadata, deletes storage first, and retains the message', () => {
  const source = read('routes/media.s3.js');
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /await s3Media\.deleteObject\(media\)[\s\S]*DELETE FROM media/);
  assert.doesNotMatch(source, /DELETE FROM messages/);
  assert.match(source, /external_deleted=\$\{externalDeleted\}/);
});

test('metadata alteration changes display_name without rewriting source identity', () => {
  const source = read('routes/media.s3.js');
  const patchHandler = source.slice(source.indexOf("router.patch('/:id'"), source.indexOf("router.delete('/:id'"));
  assert.match(patchHandler, /SET md\.display_name = \?/);
  assert.doesNotMatch(patchHandler, /s3_key\s*=/);
  assert.doesNotMatch(patchHandler, /original_filename\s*=/);
});

test('message rendering uses authenticated media content endpoint for S3 records', () => {
  const query = read('routes/messages.get.js');
  const renderer = read('public/scripts/message_handling_helpers.js');
  assert.match(query, /md\.id AS media_id/);
  assert.match(query, /md\.display_name AS media_display_name/);
  assert.match(renderer, /\/api\/media\/\$\{encodeURIComponent\(msg\.media_id\)\}\/content/);
});

test('Part 2 migration adds a separate user-editable display label', () => {
  const migration = read('mysql_db/migrations/006_s3_media_lifecycle.sql');
  assert.match(migration, /ADD COLUMN `display_name` varchar\(255\) NULL/);
});

test('generated PDF exports upload before persistence and clean up failed saves', () => {
  const exporter = read('routes/pdf.export.js');
  const storage = read('services/s3Media.js');
  assert.match(exporter, /loadExportMetadata/);
  assert.match(exporter, /page\.\$\$eval\('\[data-message-id\]'/);
  assert.match(exporter, /s3Media\.uploadPdfExport/);
  assert.match(exporter, /INSERT INTO pdf_exports/);
  assert.match(exporter, /INSERT INTO pdf_export_senders/);
  assert.match(exporter, /await connection\.commit\(\)[\s\S]*res\.end\(pdfBuffer\)/);
  assert.match(exporter, /uploadedPdf && !persisted/);
  assert.match(exporter, /deletePdfExportObject/);
  assert.match(storage, /PutObjectCommand/);
  assert.match(storage, /pdf_exports\/\$\{randomUUID\(\)\}/);
});

test('saved PDF content and deletion remain authenticated and storage-backed', () => {
  const route = read('routes/pdf.exports.js');
  const storage = read('services/s3Media.js');
  assert.match(route, /router\.get\('\/:id\/content'/);
  assert.match(route, /pe\.id = \? AND pe\.user_id = \?/);
  assert.match(route, /createPdfExportAccessUrl/);
  assert.match(route, /deletePdfExportObject[\s\S]*DELETE FROM pdf_exports/);
  assert.match(storage, /ResponseContentType: 'application\/pdf'/);
});

test('media library renders paginated PDF exports with senders and lifecycle controls', () => {
  const html = read('public/desktop/media-library.html');
  const source = read('public/scripts/media_library.js');
  assert.match(html, /id="pdfExportsHeading"/);
  assert.match(html, /id="pdfExportList"/);
  assert.match(html, /id="pdfExportsLoading"/);
  assert.match(html, /id="loadMorePdfExports"/);
  assert.match(source, /\/api\/pdf-exports\?limit=25&offset=/);
  assert.match(source, /item\.senders/);
  assert.match(source, /\/api\/pdf-exports\/\$\{encodeURIComponent\(item\.id\)\}\/content/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /pdfConversationLink/);
  assert.match(html, /id="mediaGrid"[^>]*max-h-\[24rem\][^>]*overflow-y-scroll[^>]*lg:grid-cols-3/);
});
