const pool = require('../public/scripts/db');
const defaults = Object.freeze({ save_text: true, save_photos: true, save_videos: true,
  save_audio: true, save_files: true, save_pdfs: true, max_file_size_mb: null });
const flags = Object.keys(defaults).filter(key => key !== 'max_file_size_mb');

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !Object.hasOwn(defaults, key)) ||
      flags.some(key => typeof body[key] !== 'boolean') ||
      !(body.max_file_size_mb === null || (Number.isInteger(body.max_file_size_mb) && body.max_file_size_mb >= 1 && body.max_file_size_mb <= 100000))) {
    throw new Error('Choose each content type and a whole-number file limit from 1 to 100,000 MB, or no limit.');
  }
  return Object.fromEntries(Object.keys(defaults).map(key => [key, body[key]]));
}
async function get(userId) {
  const [rows] = await pool.execute('SELECT * FROM user_storage_settings WHERE user_id = ?', [userId]);
  if (!rows[0]) return { ...defaults };
  return { ...Object.fromEntries(flags.map(key => [key, Boolean(rows[0][key])])),
    max_file_size_mb: rows[0].max_file_size_mb === null ? null : Number(rows[0].max_file_size_mb) };
}
async function save(userId, settings) {
  const keys = Object.keys(defaults);
  await pool.execute(`INSERT INTO user_storage_settings (user_id, ${keys.join(', ')})
    VALUES (?, ${keys.map(() => '?').join(', ')})
    ON DUPLICATE KEY UPDATE ${keys.map(key => `${key} = VALUES(${key})`).join(', ')}`,
  [userId, ...keys.map(key => settings[key])]);
}
module.exports = { get, save, validate, defaults };
