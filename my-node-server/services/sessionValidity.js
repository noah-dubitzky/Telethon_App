'use strict';
const pool = require('../public/scripts/db');

async function isSessionValid(session) {
  if (!session?.userId) return false;
  const [rows] = await pool.execute(
    'SELECT auth_version, status FROM users WHERE id = ? LIMIT 1', [session.userId]
  );
  return Boolean(rows[0] && rows[0].status === 'active'
    && Number(rows[0].auth_version) === Number(session.authVersion ?? 0));
}
module.exports = { isSessionValid };
