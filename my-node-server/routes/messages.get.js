const express = require('express');
const router = express.Router();
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const { resolveOwnedAccount } = require('../middleware/archiveOwnership');

router.get('/ping', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, server_time: rows[0].now });
  } catch (_err) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.use(requireAuth);

router.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.status(400).json({ error: 'A search query is required' });
  if (query.length > 200) return res.status(400).json({ error: 'Search query must be 200 characters or fewer' });

  const parsedLimit = Number.parseInt(req.query.limit || '50', 10);
  const parsedOffset = Number.parseInt(req.query.offset || '0', 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 100);
  const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);

  // Use '=' as the LIKE escape character so user-entered %, _, and = remain literal.
  const escapeLike = value => value.replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_');
  const textPattern = `%${escapeLike(query)}%`;
  const normalizedPhone = query.replace(/\D/g, '');
  const hasPhoneQuery = normalizedPhone.length > 0;
  const phonePattern = `%${escapeLike(normalizedPhone)}%`;

  try {
    const [rows] = await pool.query(
      `SELECT m.id AS message_id, m.telegram_chat_id, m.sent_at, m.text, m.is_outgoing,
              m.telegram_account_id, ta.display_name AS account_name,
              ta.phone_number AS account_phone,
              s.id AS sender_id, s.name AS sender_name, s.phone AS sender_phone,
              s.external_sender_id,
              peer.id AS peer_id, peer.name AS peer_name, peer.phone AS peer_phone,
              peer.external_sender_id AS peer_external_sender_id,
              c.id AS channel_id, c.name AS channel_name,
              CASE
                WHEN c.id IS NOT NULL THEN CONVERT(c.name USING utf8mb4) COLLATE utf8mb4_unicode_ci
                WHEN m.is_outgoing = TRUE THEN COALESCE(
                  CONVERT(peer.name USING utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CONVERT(CONCAT('Telegram chat ', m.telegram_chat_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
                )
                ELSE COALESCE(
                  CONVERT(s.name USING utf8mb4) COLLATE utf8mb4_unicode_ci,
                  CONVERT(CONCAT('Telegram chat ', m.telegram_chat_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
                )
              END AS conversation_name,
              md.id AS media_id, md.media_type, md.mime_type,
              COALESCE(
                CONVERT(md.display_name USING utf8mb4) COLLATE utf8mb4_unicode_ci,
                CONVERT(md.original_filename USING utf8mb4) COLLATE utf8mb4_unicode_ci
              ) AS media_name
       FROM messages m
       JOIN telegram_accounts ta
         ON ta.id = m.telegram_account_id AND ta.user_id = ?
       LEFT JOIN senders s
         ON s.id = m.sender_id AND s.telegram_account_id = m.telegram_account_id
       LEFT JOIN senders peer
         ON peer.telegram_account_id = m.telegram_account_id
        AND BINARY peer.external_sender_id = BINARY CAST(m.telegram_chat_id AS CHAR)
       LEFT JOIN channels c
         ON c.id = m.channel_id AND c.telegram_account_id = m.telegram_account_id
       LEFT JOIN media md ON md.message_id = m.id
       WHERE (
         CONVERT(m.text USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         OR CONVERT(s.name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         OR CONVERT(c.name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         OR CONVERT(ta.display_name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         OR CONVERT(peer.name USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         OR (? = 1 AND (
           CONVERT(s.phone USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
           OR CONVERT(peer.phone USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
           OR CONVERT(ta.phone_number USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci ESCAPE '='
         ))
       )
       ORDER BY m.sent_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [req.auth.userId, textPattern, textPattern, textPattern, textPattern, textPattern,
        hasPhoneQuery ? 1 : 0, phonePattern, phonePattern, phonePattern, limit, offset]
    );
    return res.json({
      query,
      messages: rows,
      limit,
      offset,
      has_more: rows.length === limit
    });
  } catch (err) {
    console.error('Message search failed:', err?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to search messages' });
  }
});

router.get('/recent-received', async (req, res) => {
  try {
    const parsedLimit = Number.parseInt(req.query.limit || '15', 10);
    const parsedOffset = Number.parseInt(req.query.offset || '0', 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 15, 1), 100);
    const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
    const [rows] = await pool.query(
      `SELECT m.id AS message_id, m.sent_at, m.text,
              m.telegram_account_id, ta.display_name AS account_name,
              ta.phone_number AS account_phone,
              s.id AS sender_id, s.name AS sender_name, s.phone AS sender_phone,
              s.external_sender_id, c.id AS channel_id, c.name AS channel_name,
              md.id AS media_id, md.media_type, md.mime_type,
              COALESCE(md.display_name, md.original_filename) AS media_name
       FROM messages m
       JOIN telegram_accounts ta
         ON ta.id = m.telegram_account_id AND ta.user_id = ?
       LEFT JOIN senders s
         ON s.id = m.sender_id AND s.telegram_account_id = m.telegram_account_id
       LEFT JOIN channels c
         ON c.id = m.channel_id AND c.telegram_account_id = m.telegram_account_id
       LEFT JOIN media md ON md.message_id = m.id
       WHERE m.is_outgoing = FALSE
       ORDER BY m.sent_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [req.auth.userId, limit, offset]
    );
    return res.json({ messages: rows, limit, offset, has_more: rows.length === limit });
  } catch (err) {
    console.error('Recent received-message lookup failed:', err?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve recent messages' });
  }
});

async function selection(req, res, alias) {
  const accountId = await resolveOwnedAccount(req, res);
  if (accountId === undefined) return undefined;
  return {
    sql: accountId === null ? '' : ` AND ${alias}.telegram_account_id = ?`,
    params: accountId === null ? [] : [accountId]
  };
}

const MESSAGE_COLUMNS = `
  m.id AS message_id, m.sent_at, s.name AS sender_name,
  s.phone AS sender_phone, s.external_sender_id,
  c.name AS channel_name, m.text, md.id AS media_id, md.path AS media_path, md.s3_key,
  md.original_filename, md.display_name AS media_display_name, md.mime_type, md.file_size, md.media_type`;
const MESSAGE_JOINS = `
  JOIN telegram_accounts ta ON ta.id = m.telegram_account_id AND ta.user_id = ?
  LEFT JOIN senders s ON m.sender_id = s.id AND s.telegram_account_id = m.telegram_account_id
  LEFT JOIN channels c ON m.channel_id = c.id AND c.telegram_account_id = m.telegram_account_id
  LEFT JOIN media md ON md.message_id = m.id`;

router.get('/', async (req, res) => {
  try {
    const scoped = await selection(req, res, 'm');
    if (!scoped) return;
    const parsedLimit = parseInt(req.query.limit || '50', 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 200);
    const [rows] = await pool.query(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m ${MESSAGE_JOINS}
       WHERE 1 = 1 ${scoped.sql}
       ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`,
      [req.auth.userId, ...scoped.params, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('Latest-message lookup failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/senders', async (req, res) => {
  try {
    const scoped = await selection(req, res, 's');
    if (!scoped) return;
    const [rows] = await pool.query(
      `SELECT s.id, s.telegram_account_id, s.external_sender_id, s.name, s.phone,
              ta.display_name AS account_name, ta.phone_number AS account_phone,
              MAX(m.sent_at) AS latest_message_time
       FROM senders s
       JOIN telegram_accounts ta ON ta.id = s.telegram_account_id AND ta.user_id = ?
       JOIN messages m ON m.sender_id = s.id AND m.telegram_account_id = s.telegram_account_id
       WHERE m.is_outgoing = FALSE ${scoped.sql}
       GROUP BY s.id, s.telegram_account_id, s.external_sender_id, s.name, s.phone,
                ta.display_name, ta.phone_number
       ORDER BY latest_message_time DESC, s.id DESC`,
      [req.auth.userId, ...scoped.params]
    );
    res.json(rows);
  } catch (err) {
    console.error('Sender list failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/senders/:externalId', async (req, res) => {
  try {
    const scoped = await selection(req, res, 's');
    if (!scoped) return;
    const [rows] = await pool.query(
      `SELECT s.* FROM senders s
       JOIN telegram_accounts ta ON ta.id = s.telegram_account_id AND ta.user_id = ?
       WHERE s.external_sender_id = ? ${scoped.sql} LIMIT 1`,
      [req.auth.userId, String(req.params.externalId), ...scoped.params]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Sender not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Sender lookup failed:', err?.code || 'unknown error');
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const scoped = await selection(req, res, 'c');
    if (!scoped) return;
    const [rows] = await pool.query(
      `SELECT c.id, c.name FROM channels c
       JOIN telegram_accounts ta ON ta.id = c.telegram_account_id AND ta.user_id = ?
       WHERE 1 = 1 ${scoped.sql} ORDER BY c.name ASC`,
      [req.auth.userId, ...scoped.params]
    );
    res.json(rows);
  } catch (err) {
    console.error('Channel list failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

async function messagesForEntity(req, res, type) {
  const scoped = await selection(req, res, 'm');
  if (!scoped) return;
  const id = String(type === 'sender' ? req.params.senderId : req.params.channelId);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const column = type === 'sender' ? 'm.sender_id' : 'm.channel_id';
  const [rows] = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}${type === 'channel' ? ', c.id AS channel_id' : ''}
     FROM messages m ${MESSAGE_JOINS}
     WHERE ${column} = ? ${scoped.sql}
     ORDER BY m.sent_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    [req.auth.userId, id, ...scoped.params, 50, offset]
  );
  res.json(rows);
}

async function messageContextForEntity(req, res, type) {
  const scoped = await selection(req, res, 'm');
  if (!scoped) return;
  const entityId = String(type === 'sender' ? req.params.senderId : req.params.channelId);
  const messageId = String(req.params.messageId || '');
  if (!/^\d+$/.test(entityId) || entityId === '0' || !/^\d+$/.test(messageId) || messageId === '0') {
    return res.status(404).json({ error: 'Message not found in this conversation' });
  }
  const column = type === 'sender' ? 'm.sender_id' : 'm.channel_id';
  const [anchorRows] = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}${type === 'channel' ? ', c.id AS channel_id' : ''}
     FROM messages m ${MESSAGE_JOINS}
     WHERE ${column} = ? AND m.id = ? ${scoped.sql}
     LIMIT 1`,
    [req.auth.userId, entityId, messageId, ...scoped.params]
  );
  const anchor = anchorRows[0];
  if (!anchor) return res.status(404).json({ error: 'Message not found in this conversation' });

  const [olderRows] = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}${type === 'channel' ? ', c.id AS channel_id' : ''}
     FROM messages m ${MESSAGE_JOINS}
     WHERE ${column} = ?
       AND (m.sent_at < ? OR (m.sent_at = ? AND m.id < ?)) ${scoped.sql}
     ORDER BY m.sent_at DESC, m.id DESC LIMIT 25`,
    [req.auth.userId, entityId, anchor.sent_at, anchor.sent_at, messageId, ...scoped.params]
  );
  const [newerRows] = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}${type === 'channel' ? ', c.id AS channel_id' : ''}
     FROM messages m ${MESSAGE_JOINS}
     WHERE ${column} = ?
       AND (m.sent_at > ? OR (m.sent_at = ? AND m.id > ?)) ${scoped.sql}
     ORDER BY m.sent_at ASC, m.id ASC LIMIT 25`,
    [req.auth.userId, entityId, anchor.sent_at, anchor.sent_at, messageId, ...scoped.params]
  );
  return res.json({
    anchor_message_id: Number(messageId),
    messages: [...olderRows.reverse(), anchor, ...newerRows],
    has_older: olderRows.length === 25,
    has_newer: newerRows.length === 25
  });
}

router.get('/sender/:senderId/context/:messageId', async (req, res) => {
  try { await messageContextForEntity(req, res, 'sender'); }
  catch (err) {
    console.error('Sender message context failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Unable to load message context' });
  }
});

router.get('/channel/:channelId/context/:messageId', async (req, res) => {
  try { await messageContextForEntity(req, res, 'channel'); }
  catch (err) {
    console.error('Channel message context failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Unable to load message context' });
  }
});

router.get('/sender/:senderId', async (req, res) => {
  try { await messagesForEntity(req, res, 'sender'); }
  catch (err) {
    console.error('Sender messages failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/channel/:channelId', async (req, res) => {
  try { await messagesForEntity(req, res, 'channel'); }
  catch (err) {
    console.error('Channel messages failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/entities', async (req, res) => {
  try {
    const accountId = await resolveOwnedAccount(req, res);
    if (accountId === undefined) return;
    const channelSql = accountId === null ? '' : ' AND c.telegram_account_id = ?';
    const senderSql = accountId === null ? '' : ' AND s.telegram_account_id = ?';
    const params = accountId === null
      ? [req.auth.userId, req.auth.userId]
      : [req.auth.userId, accountId, req.auth.userId, accountId];
    const [rows] = await pool.query(
      `SELECT 'channel' AS entity_type, c.id, c.name, NULL AS phone,
              NULL AS external_sender_id, MAX(m.sent_at) AS latest_message_time
       FROM channels c
       JOIN telegram_accounts ta ON ta.id = c.telegram_account_id AND ta.user_id = ?
       LEFT JOIN messages m ON m.channel_id = c.id AND m.telegram_account_id = c.telegram_account_id
       WHERE 1 = 1 ${channelSql} GROUP BY c.id, c.name
       UNION ALL
       SELECT 'sender', s.id, s.name, s.phone, s.external_sender_id, MAX(m.sent_at)
       FROM senders s
       JOIN telegram_accounts ta2 ON ta2.id = s.telegram_account_id AND ta2.user_id = ?
       LEFT JOIN messages m ON m.sender_id = s.id AND m.telegram_account_id = s.telegram_account_id
       WHERE 1 = 1 ${senderSql} GROUP BY s.id, s.name, s.phone, s.external_sender_id
       ORDER BY latest_message_time ASC`, params);
    res.json(rows);
  } catch (err) {
    console.error('Entity list failed:', err?.code || 'unknown error');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
