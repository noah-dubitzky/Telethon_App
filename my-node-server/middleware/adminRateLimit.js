'use strict';
const { createHash } = require('crypto');
const pool = require('../public/scripts/db');
module.exports = async function adminRateLimit(req, res, next) {
  try {
    // Persistent limits apply across Node processes and survive restarts.
    await pool.execute('DELETE FROM admin_login_limits WHERE resets_at <= NOW() LIMIT 100');
    for (const [label, value, limit] of [
      ['ip', req.ip, 30], ['username', String(req.body?.username || '').trim().toLowerCase().slice(0, 100), 10]
    ]) {
      const bucket = createHash('sha256').update(`${label}:${value}`).digest('hex');
      await pool.execute(`INSERT INTO admin_login_limits (bucket, attempts, resets_at)
        VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 15 MINUTE))
        ON DUPLICATE KEY UPDATE attempts = IF(resets_at <= NOW(), 1, attempts + 1),
        resets_at = IF(resets_at <= NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE), resets_at)`, [bucket]);
      const [rows] = await pool.execute('SELECT attempts FROM admin_login_limits WHERE bucket = ?', [bucket]);
      if (rows[0].attempts > limit) return res.set('Retry-After', '900').status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    next();
  } catch (_) { res.status(503).json({ error: 'Administrator login temporarily unavailable' }); }
};
