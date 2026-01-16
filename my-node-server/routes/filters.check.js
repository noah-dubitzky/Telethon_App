const express = require('express');
const router = express.Router();
const { isMessageAllowed } = require('../public/utils/filterRules.js');
const pool = require('../public/scripts/db'); // MySQL connection pool

router.get('/filters/list', async (_req, res) => {
  try {
    const [senderFilters] = await pool.query(
      `SELECT id, external_sender_id AS identifier, mode, note, created_at, 'sender' AS filter_type FROM sender_filters ORDER BY created_at DESC`
    );
    const [channelFilters] = await pool.query(
      `SELECT id, channel_key AS identifier, mode, note, created_at, 'channel' AS filter_type FROM channel_filters ORDER BY created_at DESC`
    );
    res.json({
      senderFilters,
      channelFilters
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

router.post('/filters/check', async (req, res) => {
  const { external_sender_id, channel_key } = req.body;

  const allowed = await isMessageAllowed({
    external_sender_id,
    channel_key
  });

  res.json({ allowed });
});

router.post('/filters/update', async (req, res) => {
  try {
    const { id, filterType, mode } = req.body;

    if (!id || !filterType || !mode) {
      return res.status(400).json({ error: 'Missing required fields: id, filterType, mode' });
    }

    const validModes = ['allow', 'deny'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "allow" or "deny"' });
    }

    const table = filterType === 'sender' ? 'sender_filters' : 'channel_filters';
    
    const [result] = await pool.query(
      `UPDATE ${table} SET mode = ? WHERE id = ?`,
      [mode, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Filter not found' });
    }

    res.json({ success: true, message: `Filter updated to ${mode}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = router;
