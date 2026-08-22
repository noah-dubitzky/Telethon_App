const express = require('express');
const pool = require('../public/scripts/db');
const requireWorker = require('../middleware/requireWorker');
const { decryptSecret } = require('../security/sessionEncryption');
const { isMessageAllowed } = require('../public/utils/filterRules');

const router = express.Router();
router.use(requireWorker);

function serializeAccount(row) {
  return { id: row.id, user_id: row.user_id, telegram_user_id: String(row.telegram_user_id), display_name: row.display_name,
    connection_status: row.connection_status, session: decryptSecret(row.session_ciphertext, row.session_key_version) };
}

router.get('/accounts', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id
       FROM telegram_accounts WHERE session_ciphertext IS NOT NULL
         AND connection_status IN ('connected', 'starting') ORDER BY id`);
    // Decrypt each account only when it is started. One corrupt/key-version
    // mismatch must not prevent the worker from discovering all other IDs.
    res.json({ accounts: rows });
  } catch (error) {
    console.error(`Worker account restore failed: reason=${error.code || 'unknown'}`);
    res.status(500).json({ error: 'Unable to load worker accounts' });
  }
});

router.get('/accounts/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, user_id, telegram_user_id, display_name, connection_status, session_ciphertext, session_key_version
       FROM telegram_accounts WHERE id = ? AND session_ciphertext IS NOT NULL
         AND connection_status IN ('connected', 'starting', 'disconnected', 'error') LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Eligible account not found' });
    res.json({ account: serializeAccount(rows[0]) });
  } catch (error) {
    console.error(`Worker account lookup failed: account=${req.params.id} reason=${error.code || 'unknown'}`);
    res.status(500).json({ error: 'Unable to load worker account' });
  }
});

router.patch('/accounts/:id/status', async (req, res) => {
  const allowed = new Set(['starting', 'connected', 'disconnected', 'error', 'revoked']);
  if (!allowed.has(req.body?.status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const [result] = await pool.execute(
      `UPDATE telegram_accounts SET connection_status = ?, last_seen_at = NOW() WHERE id = ?`,
      [req.body.status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Account not found' });
    res.json({ status: req.body.status });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update worker status' });
  }
});

router.post('/filters/check', async (req, res) => {
  const accountId = Number(req.body?.telegram_account_id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return res.status(400).json({ error: 'telegram_account_id is required' });
  const allowed = await isMessageAllowed({ ...req.body, telegram_account_id: accountId });
  res.json({ allowed });
});

module.exports = router;
