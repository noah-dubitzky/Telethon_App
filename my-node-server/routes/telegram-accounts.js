const express = require('express');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const SAFE_ACCOUNT_COLUMNS = `
  id, telegram_user_id, display_name, connection_status,
  connected_at, last_seen_at, created_at, updated_at
`;

router.use(requireAuth);

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
  if (!/^\d+$/.test(req.params.id) || req.params.id === '0') {
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
