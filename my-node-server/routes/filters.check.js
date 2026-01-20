const express = require('express');
const router = express.Router();
const { isMessageAllowed } = require('../public/utils/filterRules.js');
const pool = require('../public/scripts/db'); // MySQL connection pool

router.get('/filters/list', async (_req, res) => {
  try {
    const [senderFilters] = await pool.query(
      `SELECT id, name AS identifier, mode, note, created_at, 'sender' AS filter_type FROM sender_filters ORDER BY created_at DESC`
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
  const { external_sender_id, sender_name, channel_key } = req.body;

  const allowed = await isMessageAllowed({
    external_sender_id,
    sender_name,
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

router.post('/filters/create', async (req, res) => {
  try {
    const { filterType, identifier, mode, note } = req.body;

    if (!filterType || !identifier || !mode) {
      return res.status(400).json({ error: 'Missing required fields: filterType, identifier, mode' });
    }

    const validModes = ['allow', 'deny'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "allow" or "deny"' });
    }

    if (filterType !== 'sender' && filterType !== 'channel') {
      return res.status(400).json({ error: 'Invalid filterType. Must be "sender" or "channel"' });
    }

    try {
      if (filterType === 'sender') {
        const [result] = await pool.query(
          `INSERT INTO sender_filters (name, mode, note) VALUES (?, ?, ?)`,
          [identifier, mode, note || null]
        );
        res.json({ success: true, message: 'Sender filter created successfully', id: result.insertId });
      } else {
        const [result] = await pool.query(
          `INSERT INTO channel_filters (channel_key, mode, note) VALUES (?, ?, ?)`,
          [identifier, mode, note || null]
        );
        res.json({ success: true, message: 'Channel filter created successfully', id: result.insertId });
      }
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'This filter already exists' });
      }
      throw dbErr;
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

router.post('/filters/delete', async (req, res) => {
  try {
    const { id, filterType } = req.body;

    if (!id || !filterType) {
      return res.status(400).json({ error: 'Missing required fields: id, filterType' });
    }

    if (filterType !== 'sender' && filterType !== 'channel') {
      return res.status(400).json({ error: 'Invalid filterType. Must be "sender" or "channel"' });
    }

    const table = filterType === 'sender' ? 'sender_filters' : 'channel_filters';
    
    const [result] = await pool.query(
      `DELETE FROM ${table} WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Filter not found' });
    }

    res.json({ success: true, message: 'Filter deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = router;
