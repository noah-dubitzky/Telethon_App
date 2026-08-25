'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const expectedColumns = {
  path: { nullable: 'YES', type: 'varchar(1024)' },
  s3_key: { nullable: 'YES', type: 'varchar(512)' },
  original_filename: { nullable: 'YES', type: 'varchar(255)' },
  mime_type: { nullable: 'YES', type: 'varchar(255)' },
  file_size: { nullable: 'YES', type: 'bigint unsigned' }
};

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'messaging_personal'
  });

  try {
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media'`
    );
    const byName = Object.fromEntries(columns.map(row => [row.COLUMN_NAME, row]));
    for (const [name, expected] of Object.entries(expectedColumns)) {
      assert.ok(byName[name], `media.${name} must exist`);
      assert.equal(byName[name].IS_NULLABLE, expected.nullable, `media.${name} nullability`);
      assert.equal(byName[name].COLUMN_TYPE.toLowerCase(), expected.type, `media.${name} type`);
    }
    assert.match(byName.media_type.COLUMN_TYPE,
      /^enum\('images','videos','audio','documents','stickers','voice','other'\)$/i);

    const [indexes] = await connection.execute("SHOW INDEX FROM media WHERE Key_name = 'uk_media_s3_key'");
    assert.equal(indexes.length, 1, 'unique S3 key index must exist');
    assert.equal(indexes[0].Non_unique, 0, 'S3 key index must be unique');

    // Exercise real MySQL persistence inside a transaction and always roll it back.
    await connection.beginTransaction();
    try {
      const [[account]] = await connection.execute('SELECT id, user_id FROM telegram_accounts ORDER BY id LIMIT 1');
      assert.ok(account, 'at least one Telegram account is required for the persistence check');
      const uniqueId = -Math.floor(Date.now() / 1000);
      const [message] = await connection.execute(
        `INSERT INTO messages
           (telegram_account_id, telegram_chat_id, telegram_message_id, sender_id, channel_id, sent_at, text)
         VALUES (?, ?, ?, NULL, NULL, NOW(), ?)`,
        [account.id, uniqueId, uniqueId, 'S3 integration test (rolled back)']
      );
      const s3Key = `users/${account.user_id}/telegram_accounts/${account.id}/images/${uniqueId}_${uniqueId}.jpg`;
      await connection.execute(
        `INSERT INTO media
           (message_id, path, s3_key, original_filename, mime_type, file_size, media_type)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [message.insertId, s3Key, 'integration-test.jpg', 'image/jpeg', 29, 'images']
      );
      const [[stored]] = await connection.execute(
        'SELECT path, s3_key, original_filename, mime_type, file_size, media_type FROM media WHERE message_id = ?',
        [message.insertId]
      );
      assert.equal(stored.path, null);
      assert.equal(stored.s3_key, s3Key);
      assert.equal(stored.original_filename, 'integration-test.jpg');
      assert.equal(stored.mime_type, 'image/jpeg');
      assert.equal(Number(stored.file_size), 29);
      assert.equal(stored.media_type, 'images');
    } finally {
      await connection.rollback();
    }

    console.log('Live MySQL S3 media schema and rollback persistence test passed');
  } finally {
    await connection.end();
  }
}

run().catch(error => {
  console.error(`Live MySQL S3 media test failed: ${error.message}`);
  process.exitCode = 1;
});
