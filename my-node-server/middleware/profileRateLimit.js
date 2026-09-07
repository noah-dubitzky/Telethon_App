'use strict';
const pool = require('../public/scripts/db');
module.exports = function profileRateLimit(action, limit = 10) {
  return async (req, res, next) => {
    try {
      await pool.execute(
        `INSERT INTO user_security_limits (user_id, action, attempts, resets_at)
         VALUES (?, ?, 1, DATE_ADD(NOW(), INTERVAL 15 MINUTE))
         ON DUPLICATE KEY UPDATE
           attempts = IF(resets_at <= NOW(), 1, attempts + 1),
           resets_at = IF(resets_at <= NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE), resets_at)`,
        [req.auth.userId, action]
      );
      const [rows] = await pool.execute(
        'SELECT attempts FROM user_security_limits WHERE user_id = ? AND action = ?',
        [req.auth.userId, action]
      );
      if (rows[0].attempts > limit) {
        res.setHeader('Retry-After', '900');
        return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
      }
      next();
    } catch (_) {
      res.status(503).json({ error: 'Unable to process this change. Please try again.' });
    }
  };
};
