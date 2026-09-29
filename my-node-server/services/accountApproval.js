'use strict';
const pool = require('../public/scripts/db');
const { controlAccount } = require('./telegramWorkerClient');
const { cancelUserTransfers } = require('./protectedStream');

async function setApproval(userId, approved, realtime) {
  const connection = await pool.getConnection();
  let accounts = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id, is_approved FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!rows[0]) throw Object.assign(new Error('User not found'), { status: 404 });
    // Increment only on a transition; retries of a suspension remain idempotent.
    await connection.execute(`UPDATE users SET auth_version = auth_version + IF(is_approved = TRUE AND ? = FALSE, 1, 0),
      is_approved = ? WHERE id = ?`, [approved, approved, userId]);
    if (!approved) {
      [accounts] = await connection.execute('SELECT id FROM telegram_accounts WHERE user_id = ?', [userId]);
      await connection.execute(`UPDATE telegram_accounts SET connection_status = 'disconnected'
        WHERE user_id = ? AND connection_status IN ('connected', 'starting')`, [userId]);
      await connection.execute('DELETE FROM telegram_login_attempts WHERE user_id = ?', [userId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  let workerPausePending = false;
  if (!approved) {
    cancelUserTransfers(userId);
    // DB state is already authoritative even when a worker/socket server is down.
    if (realtime) await realtime.disconnectUser(userId).catch(() => {});
    const results = await Promise.allSettled(accounts.map(account => controlAccount('pause', account.id)));
    workerPausePending = results.some(result => result.status === 'rejected');
  }
  return { id: userId, is_approved: approved, worker_pause_pending: workerPausePending };
}
module.exports = { setApproval };
