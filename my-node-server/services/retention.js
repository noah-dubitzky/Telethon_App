const pool = require('../public/scripts/db');
const s3 = require('./s3Media');
const fields = ['text_retention_days', 'media_retention_days', 'pdf_retention_days'];
function validate(body) {
  if (!body || Object.keys(body).length !== 3 || fields.some(key =>
    !(body[key] === null || (Number.isInteger(body[key]) && body[key] >= 1 && body[key] <= 36500)))) {
    throw new Error('Choose Forever or a whole number of days between 1 and 36,500 for each category.');
  }
  return Object.fromEntries(fields.map(key => [key, body[key]]));
}
async function get(userId, db = pool, lock = false) {
  if (lock) await db.execute('INSERT IGNORE INTO user_storage_settings (user_id) VALUES (?)', [userId]);
  const [rows] = await db.execute(`SELECT ${fields.join(', ')} FROM user_storage_settings WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`, [userId]);
  return Object.fromEntries(fields.map(key => [key, rows[0]?.[key] == null ? null : Number(rows[0][key])]));
}
const shortened = (before, after) => fields.some(key => after[key] !== null && (before[key] === null || after[key] < before[key]));
const fingerprint = settings => JSON.stringify(fields.map(key => settings[key]));
const pdf = `(LOWER(COALESCE(SUBSTRING_INDEX(md.mime_type, ';', 1), '')) = 'application/pdf'
  OR LOWER(COALESCE(md.s3_key, '')) LIKE '%.pdf'
  OR md.s3_key LIKE 'users/%/telegram_accounts/%/pdf_exports/%')`;
function query(kind, count = false) {
  if (kind === 'text') return `SELECT ${count ? 'COUNT(*) AS count' : 'm.id'} FROM messages m
    JOIN telegram_accounts ta ON ta.id = m.telegram_account_id
    WHERE ta.user_id = ? AND m.text IS NOT NULL AND OCTET_LENGTH(m.text) > 0
    AND m.saved_at <= TIMESTAMPADD(DAY, -?, ?)`;
  if (kind === 'exports') return `SELECT ${count ? 'COUNT(*) AS count' : 'pe.id, pe.storage_key, pe.telegram_account_id, pe.user_id'}
    FROM pdf_exports pe WHERE pe.user_id = ? AND pe.created_at <= TIMESTAMPADD(DAY, -?, ?)`;
  return `SELECT ${count ? 'COUNT(*) AS count' : 'md.id, md.s3_key, m.telegram_account_id, ta.user_id'} FROM media md
    JOIN messages m ON m.id = md.message_id JOIN telegram_accounts ta ON ta.id = m.telegram_account_id
    WHERE ta.user_id = ? AND md.s3_key IS NOT NULL AND md.s3_key <> ''
    AND ${kind === 'pdfs' ? '' : 'NOT '}${pdf}
    AND md.saved_at <= TIMESTAMPADD(DAY, -?, ?)`;
}
const categories = { text: 'text_retention_days', media: 'media_retention_days', pdfs: 'pdf_retention_days', exports: 'pdf_retention_days' };
async function preview(userId, settings, db = pool) {
  const [[{ now }]] = await db.query('SELECT CURRENT_TIMESTAMP AS now');
  const counts = { text: 0, media: 0, pdfs: 0 };
  for (const [kind, key] of Object.entries(categories)) {
    if (settings[key] === null) continue;
    const [[row]] = await db.execute(query(kind, true), [userId, settings[key], now]);
    counts[kind === 'exports' ? 'pdfs' : kind] += Number(row.count);
  }
  return counts;
}

async function cleanupUser(userId, db) {
  await db.beginTransaction();
  try {
    const settings = await get(userId, db, true);
    const [[{ now }]] = await db.query('SELECT CURRENT_TIMESTAMP AS now');
    for (const [kind, key] of Object.entries(categories)) {
      if (settings[key] === null) continue;
      // Bounded batches; unsuccessful objects remain eligible next hour.
      const [rows] = await db.execute(query(kind) + ' ORDER BY ' + (kind === 'text' ? 'm' : kind === 'exports' ? 'pe' : 'md') + '.id LIMIT 100 FOR UPDATE', [userId, settings[key], now]);
      for (const row of rows) {
        if (kind === 'text') {
          await db.execute('UPDATE messages SET text = NULL WHERE id = ?', [row.id]);
          continue;
        }
        try {
          if (kind === 'exports') await s3.deletePdfExportObject({ storageKey: row.storage_key, userId: row.user_id, accountId: row.telegram_account_id });
          else await s3.deleteObject(row);
        } catch (error) {
          console.error(`Retention S3 deletion failed: user=${userId} kind=${kind} id=${row.id} reason=${error.code || error.name}`);
          continue;
        }
        await db.execute(`DELETE FROM ${kind === 'exports' ? 'pdf_exports' : 'media'} WHERE id = ?`, [row.id]);
      }
    }
    await db.commit();
  } catch (error) { await db.rollback(); throw error; }
}
let running = false;
async function run() {
  if (running) return;
  running = true;
  let db;
  let locked = false;
  try {
    db = await pool.getConnection();
    const [[row]] = await db.query("SELECT GET_LOCK('telesaver_retention', 0) AS acquired");
    locked = Number(row.acquired) === 1;
    if (!locked) return;
    const [users] = await db.query(`SELECT user_id FROM user_storage_settings WHERE ${fields.map(key => `${key} IS NOT NULL`).join(' OR ')}`);
    for (const user of users) {
      try { await cleanupUser(user.user_id, db); }
      catch (error) { console.error(`Retention cleanup failed: user=${user.user_id} reason=${error.code || error.name}`); }
    }
  } catch (error) { console.error(`Retention task failed: reason=${error.code || error.name}`); }
  finally {
    if (db) {
      if (locked) await db.query("SELECT RELEASE_LOCK('telesaver_retention')").catch(() => {});
      db.release();
    }
    running = false;
  }
}
function start() {
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  void run();
  return timer;
}
module.exports = { fields, validate, get, shortened, fingerprint, preview, cleanupUser, run, start };
