'use strict';
const pool = require('../public/scripts/db');
module.exports = async function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ error: 'Administrator authentication required' });
  try {
    const [rows] = await pool.execute('SELECT id, auth_version FROM admins WHERE id = ? LIMIT 1', [req.session.adminId]);
    if (!rows[0] || Number(rows[0].auth_version) !== Number(req.session.adminAuthVersion)) {
      return req.session.destroy(() => res.status(401).json({ error: 'Administrator authentication required' }));
    }
    next();
  } catch (_) { res.status(503).json({ error: 'Unable to verify administrator session' }); }
};
