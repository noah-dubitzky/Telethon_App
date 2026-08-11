const pool = require('../public/scripts/db');

function suppliedAccountId(req) {
  return req.query?.telegram_account_id ?? req.body?.telegram_account_id ?? null;
}

async function resolveOwnedAccount(req, res, { required = false } = {}) {
  const requestedId = suppliedAccountId(req);
  if (requestedId !== null && requestedId !== undefined && requestedId !== '') {
    if (!/^\d+$/.test(String(requestedId)) || String(requestedId) === '0') {
      res.status(404).json({ error: 'Telegram account not found' });
      return undefined;
    }
    const [rows] = await pool.execute(
      'SELECT id FROM telegram_accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [String(requestedId), req.auth.userId]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Telegram account not found' });
      return undefined;
    }
    return rows[0].id;
  }

  if (!required) return null;
  const [rows] = await pool.execute(
    'SELECT id FROM telegram_accounts WHERE user_id = ? ORDER BY id LIMIT 2',
    [req.auth.userId]
  );
  if (rows.length === 1) return rows[0].id;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Telegram account not found' });
    return undefined;
  }
  res.status(400).json({ error: 'telegram_account_id is required when multiple accounts are connected' });
  return undefined;
}

module.exports = { resolveOwnedAccount };
