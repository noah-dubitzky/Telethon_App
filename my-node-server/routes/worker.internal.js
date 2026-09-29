const express = require('express');
const pool = require('../public/scripts/db');
const requireWorker = require('../middleware/requireWorker');
const { decryptSecret } = require('../security/sessionEncryption');
const { isMessageAllowed } = require('../public/utils/filterRules');
const { accountEligible } = require('../services/workerEligibility');

const router = express.Router();
router.use(requireWorker);

function serializeAccount(row) {
  return { id: row.id, user_id: row.user_id, telegram_user_id: String(row.telegram_user_id), display_name: row.display_name,
    connection_status: row.connection_status, session: decryptSecret(row.session_ciphertext, row.session_key_version) };
}

router.get('/eligibility', async (_req, res) => {
  try {
    const [accounts] = await pool.execute(`SELECT ta.id, u.auth_version FROM telegram_accounts ta
      JOIN users u ON u.id = ta.user_id WHERE u.is_approved = TRUE AND u.status = 'active'
      AND ta.session_ciphertext IS NOT NULL AND ta.connection_status <> 'removed'`);
    res.json({ accounts });
  } catch (_) { res.status(503).json({ error: 'Unable to verify worker eligibility' }); }
});

router.use(async (req, res, next) => {
  const match = req.path.match(/^\/accounts\/(\d+)(?:\/|$)/);
  const accountId = match?.[1] || (req.path === '/filters/check' ? req.body?.telegram_account_id : null);
  // A stopped worker must be able to acknowledge its disconnected state.
  if (req.method === 'PATCH' && /\/status$/.test(req.path) && req.body?.status === 'disconnected') return next();
  if (!accountId) return next();
  try {
    const eligible = await accountEligible(accountId);
    if (!eligible) return res.status(403).json({ error: 'ACCOUNT_NOT_APPROVED' });
    req.workerAuthVersion = Number(eligible.auth_version);
    next();
  } catch (_) { res.status(503).json({ error: 'Unable to verify worker eligibility' }); }
});

router.get('/accounts', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id
       FROM telegram_accounts WHERE session_ciphertext IS NOT NULL
         AND connection_status IN ('connected', 'starting')
         AND user_id IN (SELECT id FROM users WHERE is_approved = TRUE AND status = 'active') ORDER BY id`);
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
    res.json({ account: { ...serializeAccount(rows[0]), auth_version: req.workerAuthVersion } });
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
      `UPDATE telegram_accounts SET connection_status = ?, last_seen_at = NOW() WHERE id = ?
        AND (? <> 'disconnected' OR connection_status IN ('connected', 'starting', 'disconnected', 'error'))
        AND (? = 'disconnected' OR user_id IN (SELECT id FROM users WHERE is_approved = TRUE AND status = 'active'))`,
      [req.body.status, req.params.id, req.body.status, req.body.status]);
    // Disconnect acknowledgments are idempotent, including removed accounts.
    if (!result.affectedRows && req.body.status !== 'disconnected') return res.status(404).json({ error: 'Eligible account not found' });
    res.json({ status: req.body.status });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update worker status' });
  }
});

router.post('/filters/check', async (req, res) => {
  const accountId = Number(req.body?.telegram_account_id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return res.status(400).json({ error: 'telegram_account_id is required' });
  try {
    const allowed = await isMessageAllowed({ ...req.body, telegram_account_id: accountId });
    res.json({ allowed });
  } catch (_) { res.status(503).json({ error: 'Unable to check filters' }); }
});

router.get('/accounts/:id/storage-settings', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT user_id FROM telegram_accounts WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    res.json({ settings: await require('../services/storageSettings').get(rows[0].user_id) });
  } catch (_) { res.status(503).json({ error: 'Unable to load storage settings.' }); }
});

module.exports = router;
