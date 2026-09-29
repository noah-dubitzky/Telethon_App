'use strict';
const pool = require('../public/scripts/db');
async function accountEligible(accountId) {
  const [rows] = await pool.execute(`SELECT u.auth_version FROM telegram_accounts ta
    JOIN users u ON u.id = ta.user_id WHERE ta.id = ? AND u.is_approved = TRUE
    AND u.status = 'active' AND ta.session_ciphertext IS NOT NULL AND ta.connection_status <> 'removed'`, [accountId]);
  return rows[0] || null;
}
module.exports = { accountEligible };
