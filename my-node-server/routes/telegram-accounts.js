const express = require('express');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const { controlAccount } = require('../services/telegramWorkerClient');

const router = express.Router();
const SAFE_ACCOUNT_COLUMNS = `
  id, telegram_user_id, display_name, connection_status,
  connected_at, last_seen_at, created_at, updated_at,
  filters_enabled, archive_enabled
`;

router.use(requireAuth);

function validAccountId(value) {
  return /^\d+$/.test(String(value)) && String(value) !== '0';
}

async function ownedAccount(req, res) {
  if (!validAccountId(req.params.id)) {
    res.status(404).json({ error: 'Telegram account not found' });
    return null;
  }
  const [rows] = await pool.execute(
    `SELECT id, connection_status,
            session_ciphertext IS NOT NULL AS has_saved_session
     FROM telegram_accounts
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [req.params.id, req.auth.userId]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Telegram account not found' });
    return null;
  }
  return rows[0];
}

function workerUnavailable(res, operation, error) {
  console.error(`Telegram worker ${operation} failed: account=${res.req.params.id} reason=${error.code || 'unknown'}`);
  return res.status(503).json({
    error: `Unable to ${operation} the Telegram account because the worker is unavailable`
  });
}

router.get('/:id/management', async (req, res) => {
  if (!validAccountId(req.params.id)) {
    return res.status(404).json({ error: 'Telegram account not found' });
  }

  try {
    const [accounts] = await pool.execute(
      `SELECT ${SAFE_ACCOUNT_COLUMNS},
         session_ciphertext IS NOT NULL AS has_saved_session,
         (SELECT COUNT(*) FROM sender_filters sf
          WHERE sf.telegram_account_id = telegram_accounts.id AND sf.mode = 'allow') AS allowed_senders,
         (SELECT COUNT(*) FROM sender_filters sf
          WHERE sf.telegram_account_id = telegram_accounts.id AND sf.mode = 'deny') AS blocked_senders,
         (SELECT COUNT(*) FROM channel_filters cf
          WHERE cf.telegram_account_id = telegram_accounts.id AND cf.mode = 'allow') AS allowed_channels,
         (SELECT COUNT(*) FROM channel_filters cf
          WHERE cf.telegram_account_id = telegram_accounts.id AND cf.mode = 'deny') AS blocked_channels
       FROM telegram_accounts
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [req.params.id, req.auth.userId]
    );
    if (!accounts[0]) {
      return res.status(404).json({ error: 'Telegram account not found' });
    }
    const row = accounts[0];
    return res.json({
      account: {
        id: row.id,
        telegram_user_id: row.telegram_user_id,
        display_name: row.display_name,
        connection_status: row.connection_status,
        filters_enabled: Boolean(row.filters_enabled),
        archive_enabled: Boolean(row.archive_enabled),
        has_saved_session: Boolean(row.has_saved_session),
        connected_at: row.connected_at,
        last_seen_at: row.last_seen_at,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      filters: {
        enabled: Boolean(row.filters_enabled),
        senders: { allowed: Number(row.allowed_senders), blocked: Number(row.blocked_senders) },
        channels: { allowed: Number(row.allowed_channels), blocked: Number(row.blocked_channels) }
      },
      links: { advanced_filters: `/desktop/filters.html?telegram_account_id=${row.id}` }
    });
  } catch (error) {
    console.error('Telegram-account management lookup failed:', error?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve Telegram account management details' });
  }
});

router.post('/:id/reconnect', async (req, res) => {
  try {
    const account = await ownedAccount(req, res);
    if (!account) return;
    if (!Boolean(account.has_saved_session) || account.connection_status === 'removed') {
      return res.status(409).json({ error: 'This Telegram account must be re-authenticated' });
    }
    await controlAccount('restart', account.id);
    return res.json({ telegram_account_id: Number(account.id), connection_status: 'connected' });
  } catch (error) {
    return workerUnavailable(res, 'reconnect', error);
  }
});

router.post('/:id/disconnect', async (req, res) => {
  try {
    const account = await ownedAccount(req, res);
    if (!account) return;
    if (!Boolean(account.has_saved_session) || account.connection_status === 'removed') {
      return res.status(409).json({ error: 'This Telegram account is already removed' });
    }
    await controlAccount('stop', account.id);
    return res.json({ telegram_account_id: Number(account.id), connection_status: 'disconnected' });
  } catch (error) {
    return workerUnavailable(res, 'disconnect', error);
  }
});

router.patch('/:id/archive-enabled', async (req, res) => {
  if (!validAccountId(req.params.id)) {
    return res.status(404).json({ error: 'Telegram account not found' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  try {
    const [result] = await pool.execute(
      `UPDATE telegram_accounts SET archive_enabled = ? WHERE id = ? AND user_id = ?`,
      [req.body.enabled, req.params.id, req.auth.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Telegram account not found' });
    return res.json({ telegram_account_id: Number(req.params.id), archive_enabled: req.body.enabled });
  } catch (error) {
    console.error('Telegram-account archive toggle failed:', error?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to update archive state' });
  }
});

router.delete('/:id/connection', async (req, res) => {
  try {
    const account = await ownedAccount(req, res);
    if (!account) return;
    if (Boolean(account.has_saved_session)) {
      try {
        await controlAccount('stop', account.id);
      } catch (error) {
        return workerUnavailable(res, 'remove', error);
      }
    }
    await pool.execute(
      `UPDATE telegram_accounts
       SET session_ciphertext = NULL, session_key_version = NULL,
           worker_assignment = NULL, connection_status = 'removed', archive_enabled = FALSE
       WHERE id = ? AND user_id = ?`,
      [account.id, req.auth.userId]
    );
    return res.json({
      telegram_account_id: Number(account.id),
      connection_status: 'removed',
      session_removed: true,
      archive_data_preserved: true
    });
  } catch (error) {
    console.error('Telegram-account connection removal failed:', error?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to remove Telegram connection' });
  }
});

router.patch('/:id/filters-enabled', async (req, res) => {
  if (!validAccountId(req.params.id)) {
    return res.status(404).json({ error: 'Telegram account not found' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE telegram_accounts
       SET filters_enabled = ?
       WHERE id = ? AND user_id = ?`,
      [req.body.enabled, req.params.id, req.auth.userId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Telegram account not found' });
    }
    return res.json({ telegram_account_id: Number(req.params.id), filters_enabled: req.body.enabled });
  } catch (error) {
    console.error('Telegram-account filter toggle failed:', error?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to update filter state' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [accounts] = await pool.execute(
      `SELECT ${SAFE_ACCOUNT_COLUMNS}
       FROM telegram_accounts
       WHERE user_id = ?
       ORDER BY created_at ASC, id ASC`,
      [req.auth.userId]
    );
    return res.json({ accounts });
  } catch (error) {
    console.error('Telegram-account list failed:', error && error.code ? error.code : 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve Telegram accounts' });
  }
});

router.get('/:id', async (req, res) => {
  if (!validAccountId(req.params.id)) {
    return res.status(404).json({ error: 'Telegram account not found' });
  }

  try {
    const [accounts] = await pool.execute(
      `SELECT ${SAFE_ACCOUNT_COLUMNS}
       FROM telegram_accounts
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [req.params.id, req.auth.userId]
    );
    if (!accounts[0]) {
      return res.status(404).json({ error: 'Telegram account not found' });
    }
    return res.json({ account: accounts[0] });
  } catch (error) {
    console.error('Telegram-account lookup failed:', error && error.code ? error.code : 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve Telegram account' });
  }
});

module.exports = router;
