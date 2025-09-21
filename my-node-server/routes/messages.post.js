// routes/messages.post.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /messages
router.post('/', async (req, res) => {
  const {
    sender_name,
    timestamp,
    sender_phone,
    sender_id,
    text,
    media_path,
    channel_name
  } = req.body || {};

  if (!sender_id) return res.status(400).json({ error: 'sender_id is required' });
  if (!timestamp) return res.status(400).json({ error: 'timestamp is required' });

  let sentAt;
  if (typeof timestamp === 'number') {
    sentAt = new Date(timestamp * 1000);
  } else {
    sentAt = new Date(timestamp);
  }
  if (Number.isNaN(sentAt.getTime())) {
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }
  const sentAtStr = sentAt.toISOString().slice(0, 19).replace('T', ' ');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // sender
    await conn.execute(
      `INSERT INTO senders (external_sender_id, name, phone)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         phone = VALUES(phone),
         id = LAST_INSERT_ID(id)`,
      [String(sender_id), sender_name || null, sender_phone || null]
    );
    const [[senderRow]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
    const senderPk = senderRow.id;

    // channel (nullable)
    let channelPk = null;
    if (channel_name) {
      await conn.execute(
        `INSERT INTO channels (name)
         VALUES (?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [channel_name]
      );
      const [[channelRow]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
      channelPk = channelRow.id;
    }

    // message
    const [msgRes] = await conn.execute(
      `INSERT INTO messages (sender_id, channel_id, sent_at, text)
       VALUES (?, ?, ?, ?)`,
      [senderPk, channelPk, sentAtStr, text || null]
    );
    const messagePk = msgRes.insertId;

    // media (single file for now)
    if (media_path) {
      await conn.execute(
        `INSERT INTO media (message_id, path)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE path = VALUES(path)`,
        [messagePk, media_path]
      );
    }

    await conn.commit();

    res.status(201).json({
      message_id: messagePk,
      sender_id: senderPk,
      channel_id: channelPk,
      sent_at: sentAtStr
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Database error', details: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
