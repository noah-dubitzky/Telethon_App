const express = require('express');
const router = express.Router();
const db = require('../public/scripts/db');

router.get('/', async (req, res) => {
  try {
    const channelsSql = `
      SELECT c.id,
             c.name,
             COALESCE(cf.mode, 'allow') AS mode
      FROM channels c
      LEFT JOIN channel_filters cf ON c.name = cf.channel_key
      ORDER BY c.name
    `;

    const sendersSql = `
      SELECT
        s.id,
        s.name,
        s.external_sender_id,
        GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') AS channel_name,
        COALESCE(sf.mode, 'allow') AS mode
      FROM senders s
      LEFT JOIN messages m ON m.sender_id = s.id
      LEFT JOIN channels c ON m.channel_id = c.id
      LEFT JOIN sender_filters sf ON s.external_sender_id = sf.external_sender_id
      GROUP BY s.id, s.name, s.external_sender_id, sf.mode
      ORDER BY s.name
    `;

    const [channelsResults] = await db.query(channelsSql);
    const [sendersResults] = await db.query(sendersSql);

    res.json({
      channels: channelsResults.map(row => ({
        id: row.id,
        name: row.name,
        allowed: row.mode === 'allow'
      })),
      senders: sendersResults.map(row => ({
        id: row.id,
        name: row.name,
        external_sender_id: row.external_sender_id,
        channel_name: row.channel_name || '',
        allowed: row.mode === 'allow'
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load filters' });
  }
});

router.put('/channel/:channelId', async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    const allow = req.body.allow === true || req.body.allow === 'true' || req.body.allow === 1;

    if (!channelId) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const [channelRows] = await db.query(
      'SELECT name FROM channels WHERE id = ? LIMIT 1',
      [channelId]
    );

    if (!channelRows.length) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channelKey = channelRows[0].name;
    const mode = allow ? 'allow' : 'deny';

    await db.query(
      `
        INSERT INTO channel_filters (channel_key, mode)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE mode = VALUES(mode)
      `,
      [channelKey, mode]
    );

    res.json({ channelId, allowed: allow });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update channel filter' });
  }
});

router.put('/sender/:senderId', async (req, res) => {
  try {
    const senderId = Number(req.params.senderId);
    const allow = req.body.allow === true || req.body.allow === 'true' || req.body.allow === 1;

    if (!senderId) {
      return res.status(400).json({ error: 'Invalid sender ID' });
    }

    const [senderRows] = await db.query(
      'SELECT external_sender_id FROM senders WHERE id = ? LIMIT 1',
      [senderId]
    );

    if (!senderRows.length) {
      return res.status(404).json({ error: 'Sender not found' });
    }

    const externalSenderId = senderRows[0].external_sender_id;
    const mode = allow ? 'allow' : 'deny';

    await db.query(
      `
        INSERT INTO sender_filters (external_sender_id, mode)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE mode = VALUES(mode)
      `,
      [externalSenderId, mode]
    );

    res.json({ senderId, allowed: allow });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update sender filter' });
  }
});

module.exports = router;