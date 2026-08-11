const express = require('express');
const router = express.Router();
const { isMessageAllowed } = require('../public/utils/filterRules');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const { resolveOwnedAccount } = require('../middleware/archiveOwnership');

// Legacy worker endpoint. It intentionally stays outside website-session auth
// until worker credentials and account IDs can be added without changing Python.
router.post('/filters/check', async (req, res) => {
  try {
    const { external_sender_id, sender_name, channel_key } = req.body;
    const allowed = await isMessageAllowed({ external_sender_id, sender_name, channel_key });
    res.json({ allowed });
  } catch (_err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.use(requireAuth);

router.get('/filters/list', async (req, res) => {
  try {
    const accountId = await resolveOwnedAccount(req, res);
    if (accountId === undefined) return;
    const scope = accountId === null ? '' : ' AND f.telegram_account_id = ?';
    const params = accountId === null ? [req.auth.userId] : [req.auth.userId, accountId];
    const [senderFilters] = await pool.query(
      `SELECT f.id, COALESCE(f.external_sender_id, f.name) AS identifier, f.mode, f.note,
              f.created_at, 'sender' AS filter_type
       FROM sender_filters f JOIN telegram_accounts ta ON ta.id = f.telegram_account_id AND ta.user_id = ?
       WHERE 1 = 1 ${scope} ORDER BY f.created_at DESC`, params);
    const [channelFilters] = await pool.query(
      `SELECT f.id, f.channel_key AS identifier, f.mode, f.note, f.created_at, 'channel' AS filter_type
       FROM channel_filters f JOIN telegram_accounts ta ON ta.id = f.telegram_account_id AND ta.user_id = ?
       WHERE 1 = 1 ${scope} ORDER BY f.created_at DESC`, params);
    res.json({ senderFilters, channelFilters });
  } catch (err) {
    console.error('Filter list failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

function tableFor(filterType) {
  if (filterType === 'sender') return 'sender_filters';
  if (filterType === 'channel') return 'channel_filters';
  return null;
}

router.post('/filters/update', async (req, res) => {
  try {
    const { id, filterType, mode } = req.body;
    const table = tableFor(filterType);
    if (!id || !table || !['allow', 'deny'].includes(mode)) return res.status(400).json({ error: 'Invalid filter fields' });
    const [result] = await pool.query(
      `UPDATE ${table} f JOIN telegram_accounts ta ON ta.id = f.telegram_account_id
       SET f.mode = ? WHERE f.id = ? AND ta.user_id = ?`, [mode, id, req.auth.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Filter not found' });
    res.json({ success: true, message: `Filter updated to ${mode}` });
  } catch (err) {
    console.error('Filter update failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/filters/create', async (req, res) => {
  try {
    const { filterType, identifier, mode, note } = req.body;
    if (!tableFor(filterType) || !identifier || !['allow', 'deny'].includes(mode)) return res.status(400).json({ error: 'Invalid filter fields' });
    const accountId = await resolveOwnedAccount(req, res, { required: true });
    if (accountId === undefined) return;
    const sql = filterType === 'sender'
      ? 'INSERT INTO sender_filters (telegram_account_id, name, mode, note) VALUES (?, ?, ?, ?)'
      : 'INSERT INTO channel_filters (telegram_account_id, channel_key, mode, note) VALUES (?, ?, ?, ?)';
    const [result] = await pool.query(sql, [accountId, identifier, mode, note || null]);
    res.json({ success: true, message: `${filterType === 'sender' ? 'Sender' : 'Channel'} filter created successfully`, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This filter already exists' });
    console.error('Filter creation failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/filters/delete', async (req, res) => {
  try {
    const { id, filterType } = req.body;
    const table = tableFor(filterType);
    if (!id || !table) return res.status(400).json({ error: 'Invalid filter fields' });
    const [result] = await pool.query(
      `DELETE f FROM ${table} f JOIN telegram_accounts ta ON ta.id = f.telegram_account_id
       WHERE f.id = ? AND ta.user_id = ?`, [id, req.auth.userId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Filter not found' });
    res.json({ success: true, message: 'Filter deleted successfully' });
  } catch (err) {
    console.error('Filter deletion failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
