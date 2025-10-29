// routes/messages.get.js
const express = require('express');
const router = express.Router();
const pool = require('../public/scripts/db'); // MySQL connection pool (public/scripts/db.js)

// ✅ 1) Health check
router.get('/ping', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, server_time: rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ 2) Latest messages (joined)
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const [rows] = await pool.query(
      `SELECT
         m.id AS message_id,
         m.sent_at,
         s.name AS sender_name,
         s.phone AS sender_phone,
         s.external_sender_id,
         c.name AS channel_name,
         m.text,
         md.path AS media_path
       FROM messages m
       JOIN senders s        ON m.sender_id = s.id
       LEFT JOIN channels c  ON m.channel_id = c.id
       LEFT JOIN media md    ON md.message_id = m.id
       ORDER BY m.sent_at DESC, m.id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// ✅ 3) All senders who have sent at least one message with channel_id IS NULL (DMs)
router.get('/senders', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT
         s.id,
         s.external_sender_id,
         s.name,
         s.phone
       FROM senders s
       JOIN messages m ON m.sender_id = s.id
       WHERE m.channel_id IS NULL
       ORDER BY s.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// ✅ Get sender info by external_sender_id
router.get('/senders/:externalId', async (req, res) => {
  try {
    const externalId = String(req.params.externalId);
    const [rows] = await pool.query(
      `SELECT *
       FROM senders
       WHERE senders.external_sender_id = ?`,
      [externalId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Sender not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching sender by external ID:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ 4) All channels
router.get('/channels', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name
       FROM channels
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// ✅ 5) All messages from a certain sender (by external_sender_id)
router.get('/sender/:senderId', async (req, res) => {
  try {
    const senderId = String(req.params.senderId);
    const [rows] = await pool.query(
      `SELECT
         m.id AS message_id,
         m.sent_at,
         s.name AS sender_name,
         s.phone AS sender_phone,
         s.external_sender_id,
         c.name AS channel_name,
         m.text,
         md.path AS media_path
       FROM messages m
       JOIN senders s        ON m.sender_id = s.id
       LEFT JOIN channels c  ON m.channel_id = c.id
       LEFT JOIN media md    ON md.message_id = m.id
       WHERE m.sender_id = ?
       ORDER BY m.id ASC`,
      [senderId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// ✅ 6) Messages from a certain channel (by channel name, limit 50)
router.get('/channel/:channelId', async (req, res) => {
  try {
    const channelId = req.params.channelId;

    const [rows] = await pool.query(
      `SELECT
         m.id AS message_id,
         m.sent_at,
         s.name AS sender_name,
         s.phone AS sender_phone,
         s.external_sender_id,
         c.id AS channel_id,
         c.name AS channel_name,
         m.text,
         md.path AS media_path
       FROM messages m
       LEFT JOIN senders s        ON m.sender_id = s.id
       JOIN channels c       ON m.channel_id = c.id
       LEFT JOIN media md    ON md.message_id = m.id
       WHERE c.id = ?
       ORDER BY m.sent_at ASC, m.id ASC
       LIMIT 50`,
      [channelId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No messages found for this channel ID.' });
    }

    res.json(rows);
  } catch (err) {
    console.error('Error fetching channel messages by ID:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

router.get('/entities', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        'channel' AS entity_type,
        c.id AS id,
        c.name AS name,
        NULL AS phone,
        NULL AS external_sender_id,
        MAX(m.sent_at) AS latest_message_time
      FROM channels c
      LEFT JOIN messages m ON m.channel_id = c.id
      GROUP BY c.id

      UNION ALL

      SELECT 
        'sender' AS entity_type,
        s.id AS id,
        s.name AS name,
        s.phone AS phone,
        s.external_sender_id AS external_sender_id,
        MAX(m.sent_at) AS latest_message_time
      FROM senders s
      LEFT JOIN messages m ON m.sender_id = s.id
      GROUP BY s.id

      ORDER BY latest_message_time ASC;
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});


module.exports = router;
