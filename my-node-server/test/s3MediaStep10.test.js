const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('S3 migration preserves legacy paths and adds private object metadata', () => {
  const migration = read('mysql_db/migrations/005_s3_media_storage.sql');
  assert.match(migration, /MODIFY COLUMN `path` varchar\(1024\) NULL/i);
  for (const column of ['s3_key', 'original_filename', 'mime_type', 'file_size', 'media_type']) {
    assert.ok(migration.includes('ADD COLUMN `' + column + '`'), `migration must add media.${column}`);
  }
  assert.match(migration, /ADD UNIQUE KEY `uk_media_s3_key` \(`s3_key`\)/i);
});

test('worker account response obtains S3 ownership from the database', () => {
  const source = read('routes/worker.internal.js');
  assert.match(source, /SELECT id, user_id, telegram_user_id/);
  assert.match(source, /user_id: row\.user_id/);
});

test('message ingestion validates ownership before storing S3 metadata', () => {
  const source = read('routes/messages.post.js');
  assert.match(source, /SELECT user_id FROM telegram_accounts WHERE id = \?/);
  assert.match(source, /users\/\$\{owner\.user_id\}\/telegram_accounts\/\$\{accountId\}\//);
  assert.match(source, /!String\(media\.s3_key\)\.startsWith\(expectedPrefix\)/);
  assert.match(source, /INSERT INTO media \(message_id, s3_key, original_filename, mime_type, file_size, media_type\)/);
  assert.match(source, /else if \(media_path\)/, 'legacy local media must remain supported');
});

test('message reads return both legacy paths and S3 keys', () => {
  const source = read('routes/messages.get.js');
  assert.match(source, /md\.path AS media_path, md\.s3_key/);
});
