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
  c.name AS channel_name, m.text, md.path AS media_path, md.s3_key`;
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
      `SELECT DISTINCT s.id, s.external_sender_id, s.name, s.phone
       FROM senders s
       JOIN telegram_accounts ta ON ta.id = s.telegram_account_id AND ta.user_id = ?
       JOIN messages m ON m.sender_id = s.id AND m.telegram_account_id = s.telegram_account_id
       WHERE m.channel_id IS NULL ${scoped.sql} ORDER BY s.id DESC`,
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
