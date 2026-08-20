// routes/messages.post.js
const express = require('express');
const router = express.Router();
const pool = require('../public/scripts/db');
const { isMessageAllowed } = require('../public/utils/filterRules');
const requireWorker = require('../middleware/requireWorker');

// POST /messages
router.post('/', requireWorker, async (req, res) => {
  const {
    sender_name,
    timestamp,
    sender_phone,
    sender_id,
    text,
    media_path,
    channel_name,
    channel_id,
    telegram_account_id,
    telegram_chat_id,
    telegram_message_id
  } = req.body || {};

  const accountId = Number(telegram_account_id);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return res.status(400).json({ error: 'telegram_account_id is required' });

  const allowed = await isMessageAllowed({
    external_sender_id: sender_id,
    sender_name: sender_name,
    channel_key: channel_name,
    telegram_account_id: accountId
  });

  if (!allowed) {
    return res.status(204).end(); // skip silently
  }

  //if (!sender_id) return res.status(400).json({ error: 'sender_id is required' });
  if (!timestamp) return res.status(400).json({ error: 'timestamp is required' });

  // example input: "2025-10-18 10:15:53"
  const timestampRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  if (!timestampRegex.test(timestamp)) {
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }

  const sentAtStr = timestamp; // no conversion at all
  const conn = await pool.getConnection();
  
  try {
    await conn.beginTransaction();

    let senderPk = null;

    if(sender_id){

      // sender
      await conn.execute(
        `INSERT INTO senders (telegram_account_id, external_sender_id, name, phone)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          phone = VALUES(phone),
          id = LAST_INSERT_ID(id)`,
        [accountId, String(sender_id), sender_name || null, sender_phone || null]
      );
      const [[senderRow]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
      senderPk = senderRow.id;

    }

    // channel (nullable)
    let channelPk = null;
    if (channel_name) {
      await conn.execute(
        `INSERT INTO channels (telegram_account_id, telegram_chat_id, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), id = LAST_INSERT_ID(id)`,
        [accountId, telegram_chat_id || channel_id || null, channel_name]
      );
      const [[channelRow]] = await conn.query('SELECT LAST_INSERT_ID() AS id');
      channelPk = channelRow.id;
    }

    // message
    const [msgRes] = await conn.execute(
      `INSERT INTO messages (telegram_account_id, telegram_chat_id, telegram_message_id, sender_id, channel_id, sent_at, text)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sender_id = VALUES(sender_id), channel_id = VALUES(channel_id),
         sent_at = VALUES(sent_at), text = VALUES(text), id = LAST_INSERT_ID(id)`,
      [accountId, telegram_chat_id || null, telegram_message_id || null, senderPk, channelPk, sentAtStr, text || null]
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

    const responsePayload = {
      message_id: messagePk,
      sender_id: senderPk,
      channel_id: channelPk,
      sent_at: sentAtStr
    };
    res.status(201).json(responsePayload);

    // Persistence is complete before any optional live delivery work begins.
    try {
      const [owners] = await pool.execute(
        'SELECT user_id FROM telegram_accounts WHERE id = ? LIMIT 1',
        [accountId]
      );
      if (!owners[0]) {
        console.warn(`Socket ownership lookup failed: account=${accountId}`);
      } else if (req.app.locals.realtime) {
        const livePayload = {
          telegram_account_id: accountId,
          telegram_message_id: telegram_message_id || null,
          telegram_chat_id: telegram_chat_id || null,
          message_id: messagePk,
          sender_database_id: senderPk,
          channel_database_id: channelPk,
          sender_name: sender_name || null,
          sender_phone: sender_phone || null,
          sender_id: sender_id || null,
          channel_name: channel_name || null,
          channel_id: channel_id || null,
          text: text || null,
          media_path: media_path || null,
          timestamp: sentAtStr,
          sent_at: sentAtStr
        };
        await req.app.locals.realtime.emitToUser(owners[0].user_id, 'updateMessage', livePayload);
      }
    } catch (emitError) {
      console.error(`Socket delivery failed after archive: account=${accountId} reason=${emitError.code || 'unknown'}`);
    }
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'Database error', details: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
