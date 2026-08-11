const express = require('express');
const router = express.Router();
const db = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const { resolveOwnedAccount } = require('../middleware/archiveOwnership');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const accountId = await resolveOwnedAccount(req, res);
    if (accountId === undefined) return;
    const channelScope = accountId === null ? '' : ' AND c.telegram_account_id = ?';
    const senderScope = accountId === null ? '' : ' AND s.telegram_account_id = ?';
    const [channelsResults] = await db.query(
      `SELECT c.id, c.name, COALESCE(cf.mode, 'allow') AS mode
       FROM channels c
       JOIN telegram_accounts ta ON ta.id = c.telegram_account_id AND ta.user_id = ?
       LEFT JOIN channel_filters cf
         ON cf.telegram_account_id = c.telegram_account_id
        AND (cf.telegram_chat_id = c.telegram_chat_id OR (cf.telegram_chat_id IS NULL AND cf.channel_key = c.name))
       WHERE 1 = 1 ${channelScope} ORDER BY c.name`,
      accountId === null ? [req.auth.userId] : [req.auth.userId, accountId]
    );
    const [sendersResults] = await db.query(
      `SELECT s.id, s.name, s.external_sender_id,
              GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') AS channel_name,
              COALESCE(sf.mode, 'allow') AS mode
       FROM senders s
       JOIN telegram_accounts ta ON ta.id = s.telegram_account_id AND ta.user_id = ?
       LEFT JOIN messages m ON m.sender_id = s.id AND m.telegram_account_id = s.telegram_account_id
       LEFT JOIN channels c ON m.channel_id = c.id AND c.telegram_account_id = s.telegram_account_id
       LEFT JOIN sender_filters sf
         ON sf.telegram_account_id = s.telegram_account_id AND sf.external_sender_id = s.external_sender_id
       WHERE 1 = 1 ${senderScope}
       GROUP BY s.id, s.name, s.external_sender_id, sf.mode ORDER BY s.name`,
      accountId === null ? [req.auth.userId] : [req.auth.userId, accountId]
    );
    res.json({
      channels: channelsResults.map(row => ({ id: row.id, name: row.name, allowed: row.mode === 'allow' })),
      senders: sendersResults.map(row => ({
        id: row.id, name: row.name, external_sender_id: row.external_sender_id,
        channel_name: row.channel_name || '', allowed: row.mode === 'allow'
      }))
    });
  } catch (error) {
    console.error('Filter dashboard failed:', error?.code || 'unknown error');
    res.status(500).json({ error: 'Unable to load filters' });
  }
});

router.put('/channel/:channelId', async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    if (!Number.isSafeInteger(channelId) || channelId <= 0) return res.status(400).json({ error: 'Invalid channel ID' });
    const allow = req.body.allow === true || req.body.allow === 'true' || req.body.allow === 1;
    const [rows] = await db.query(
      `SELECT c.telegram_account_id, c.telegram_chat_id, c.name
       FROM channels c JOIN telegram_accounts ta ON ta.id = c.telegram_account_id
       WHERE c.id = ? AND ta.user_id = ? LIMIT 1`, [channelId, req.auth.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Channel not found' });
    const channel = rows[0];
    await db.query(
      `INSERT INTO channel_filters (telegram_account_id, telegram_chat_id, channel_key, mode)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE mode = VALUES(mode)`,
      [channel.telegram_account_id, channel.telegram_chat_id, channel.name, allow ? 'allow' : 'deny']
    );
    res.json({ channelId, allowed: allow });
  } catch (error) {
    console.error('Channel filter update failed:', error?.code || 'unknown error');
    res.status(500).json({ error: 'Unable to update channel filter' });
  }
});

router.put('/sender/:senderId', async (req, res) => {
  try {
    const senderId = Number(req.params.senderId);
    if (!Number.isSafeInteger(senderId) || senderId <= 0) return res.status(400).json({ error: 'Invalid sender ID' });
    const allow = req.body.allow === true || req.body.allow === 'true' || req.body.allow === 1;
    const [rows] = await db.query(
      `SELECT s.telegram_account_id, s.external_sender_id
       FROM senders s JOIN telegram_accounts ta ON ta.id = s.telegram_account_id
       WHERE s.id = ? AND ta.user_id = ? LIMIT 1`, [senderId, req.auth.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Sender not found' });
    await db.query(
      `INSERT INTO sender_filters (telegram_account_id, external_sender_id, mode)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mode = VALUES(mode)`,
      [rows[0].telegram_account_id, rows[0].external_sender_id, allow ? 'allow' : 'deny']
    );
    res.json({ senderId, allowed: allow });
  } catch (error) {
    console.error('Sender filter update failed:', error?.code || 'unknown error');
    res.status(500).json({ error: 'Unable to update sender filter' });
  }
});

module.exports = router;
