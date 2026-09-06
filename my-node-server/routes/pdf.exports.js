const express = require('express');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const s3Media = require('../services/s3Media');

const router = express.Router();
router.use(requireAuth);

function positiveId(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) && text !== '0' ? text : null;
}

function telegramChatId(value) {
  const text = String(value ?? '').trim();
  return /^-?\d+$/.test(text) ? text : null;
}

function publicExport(row) {
  return {
    id: row.id,
    telegram_account_id: row.telegram_account_id,
    account_name: row.account_name,
    account_phone: row.account_phone,
    conversation_type: row.conversation_type,
    telegram_chat_id: row.telegram_chat_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    export_name: row.export_name,
    file_size: row.file_size,
    mime_type: row.mime_type,
    first_message_id: row.first_message_id,
    last_message_id: row.last_message_id,
    message_count: row.message_count,
    created_at: row.created_at,
    senders: []
  };
}

const EXPORT_SELECT = `
  SELECT pe.id, pe.telegram_account_id, pe.conversation_type,
         pe.telegram_chat_id, pe.sender_id, pe.channel_id, pe.export_name,
         pe.file_size, pe.mime_type, pe.first_message_id, pe.last_message_id,
         pe.message_count, pe.created_at,
         ta.display_name AS account_name, ta.phone_number AS account_phone,
         s.name AS sender_name, c.name AS channel_name
  FROM pdf_exports pe
  JOIN telegram_accounts ta
    ON ta.id = pe.telegram_account_id AND ta.user_id = pe.user_id
  LEFT JOIN senders s
    ON s.id = pe.sender_id AND s.telegram_account_id = pe.telegram_account_id
  LEFT JOIN channels c
    ON c.id = pe.channel_id AND c.telegram_account_id = pe.telegram_account_id`;

async function attachSenders(executor, exports) {
  if (!exports.length) return exports;
  const ids = exports.map(item => item.id);
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await executor.query(
    `SELECT pes.pdf_export_id, pes.sender_id, pes.sender_name_at_export,
            pes.message_count, s.name AS current_sender_name, s.phone
     FROM pdf_export_senders pes
     JOIN senders s
       ON s.id = pes.sender_id AND s.telegram_account_id = pes.telegram_account_id
     WHERE pes.pdf_export_id IN (${placeholders})
     ORDER BY pes.pdf_export_id, pes.message_count DESC, pes.sender_id`,
    ids
  );
  const byId = new Map(exports.map(item => [String(item.id), item]));
  rows.forEach(row => {
    const item = byId.get(String(row.pdf_export_id));
    if (item) item.senders.push({
      sender_id: row.sender_id,
      name: row.sender_name_at_export || row.current_sender_name,
      current_name: row.current_sender_name,
      phone: row.phone,
      message_count: row.message_count
    });
  });
  return exports;
}

router.get('/', async (req, res) => {
  const parsedLimit = Number.parseInt(req.query.limit || '25', 10);
  const parsedOffset = Number.parseInt(req.query.offset || '0', 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 25, 1), 100);
  const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);
  try {
    const [rows] = await pool.query(
      `${EXPORT_SELECT}
       WHERE pe.user_id = ?
       ORDER BY pe.created_at DESC, pe.id DESC
       LIMIT ? OFFSET ?`,
      [req.auth.userId, limit, offset]
    );
    const exports = await attachSenders(pool, rows.map(publicExport));
    return res.json({ pdf_exports: exports, limit, offset, has_more: rows.length === limit });
  } catch (error) {
    console.error(`PDF export list failed: user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(500).json({ error: 'Unable to retrieve PDF exports' });
  }
});

router.get('/:id/content', async (req, res) => {
  const exportId = positiveId(req.params.id);
  if (!exportId) return res.status(404).json({ error: 'PDF export not found' });
  try {
    const [rows] = await pool.query(
      `SELECT pe.storage_key, pe.export_name, pe.telegram_account_id, pe.user_id
       FROM pdf_exports pe
       WHERE pe.id = ? AND pe.user_id = ? LIMIT 1`,
      [exportId, req.auth.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'PDF export not found' });
    const expiresIn = Math.min(Math.max(Number(process.env.S3_PRESIGN_SECONDS || 300), 60), 900);
    const url = await s3Media.createPdfExportAccessUrl({
      storageKey: rows[0].storage_key,
      userId: rows[0].user_id,
      accountId: rows[0].telegram_account_id,
      filename: rows[0].export_name
    }, { expiresIn });
    res.set('Cache-Control', 'private, no-store');
    return res.redirect(302, url);
  } catch (error) {
    console.error(`PDF export content failed: export=${exportId} user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(502).json({ error: 'Unable to retrieve PDF export content' });
  }
});

router.get('/:id', async (req, res) => {
  const exportId = positiveId(req.params.id);
  if (!exportId) return res.status(404).json({ error: 'PDF export not found' });
  try {
    const [rows] = await pool.query(
      `${EXPORT_SELECT} WHERE pe.id = ? AND pe.user_id = ? LIMIT 1`,
      [exportId, req.auth.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'PDF export not found' });
    const [item] = await attachSenders(pool, [publicExport(rows[0])]);
    return res.json(item);
  } catch (error) {
    console.error(`PDF export lookup failed: export=${exportId} user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(500).json({ error: 'Unable to retrieve PDF export' });
  }
});

router.post('/', async (req, res) => {
  const accountId = positiveId(req.body?.telegram_account_id);
  const type = req.body?.conversation_type;
  const chatId = telegramChatId(req.body?.telegram_chat_id);
  const senderId = positiveId(req.body?.sender_id);
  const channelId = positiveId(req.body?.channel_id);
  const firstMessageId = positiveId(req.body?.first_message_id);
  const lastMessageId = positiveId(req.body?.last_message_id);
  const messageCount = Number.parseInt(req.body?.message_count, 10);
  const exportName = typeof req.body?.export_name === 'string' ? req.body.export_name.trim() : '';
  const storageKey = typeof req.body?.storage_key === 'string' ? req.body.storage_key.trim() : '';
  const fileSize = req.body?.file_size == null ? null : Number(req.body.file_size);
  const requestedSenders = Array.isArray(req.body?.senders) ? req.body.senders : [];

  if (!accountId || !chatId || !['direct', 'channel'].includes(type)
      || (type === 'direct' ? (!senderId || channelId) : (!channelId || senderId))) {
    return res.status(400).json({ error: 'Invalid PDF conversation identity' });
  }
  if (!exportName || exportName.length > 255 || !storageKey || storageKey.length > 512) {
    return res.status(400).json({ error: 'A valid export name and storage key are required' });
  }
  if (!firstMessageId || !lastMessageId || !Number.isSafeInteger(messageCount) || messageCount < 1) {
    return res.status(400).json({ error: 'A valid exported message range is required' });
  }
  if (fileSize !== null && (!Number.isSafeInteger(fileSize) || fileSize < 0)) {
    return res.status(400).json({ error: 'Invalid PDF file size' });
  }
  const expectedStoragePrefix = `users/${String(req.auth.userId)}/telegram_accounts/${accountId}/pdf_exports/`;
  if (!storageKey.startsWith(expectedStoragePrefix) || !storageKey.toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ error: 'Storage key does not match PDF export ownership' });
  }

  const senderMap = new Map();
  for (const entry of requestedSenders) {
    const id = positiveId(entry?.sender_id);
    const count = Number.parseInt(entry?.message_count, 10);
    if (!id || !Number.isSafeInteger(count) || count < 1) {
      return res.status(400).json({ error: 'Each exported sender requires a valid id and message count' });
    }
    senderMap.set(id, (senderMap.get(id) || 0) + count);
  }
  if (!senderMap.size) return res.status(400).json({ error: 'At least one exported sender is required' });
  const senderMessageCount = [...senderMap.values()].reduce((total, count) => total + count, 0);
  if (senderMessageCount !== messageCount) {
    return res.status(400).json({ error: 'Exported sender counts must equal the PDF message count' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [accounts] = await connection.query(
      'SELECT id FROM telegram_accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [accountId, req.auth.userId]
    );
    if (!accounts[0]) {
      await connection.rollback();
      return res.status(404).json({ error: 'Telegram account not found' });
    }

    const entityTable = type === 'direct' ? 'senders' : 'channels';
    const entityId = type === 'direct' ? senderId : channelId;
    const [entities] = await connection.query(
      `SELECT id, ${type === 'direct' ? 'external_sender_id' : 'telegram_chat_id'} AS telegram_identity
       FROM ${entityTable} WHERE id = ? AND telegram_account_id = ? LIMIT 1`,
      [entityId, accountId]
    );
    if (!entities[0] || String(entities[0].telegram_identity) !== chatId) {
      await connection.rollback();
      return res.status(400).json({ error: 'Conversation does not match the Telegram account' });
    }

    const [boundaries] = await connection.query(
      'SELECT id FROM messages WHERE telegram_account_id = ? AND id IN (?, ?)',
      [accountId, firstMessageId, lastMessageId]
    );
    const requiredBoundaryCount = firstMessageId === lastMessageId ? 1 : 2;
    if (boundaries.length !== requiredBoundaryCount) {
      await connection.rollback();
      return res.status(400).json({ error: 'Exported message range does not belong to this account' });
    }

    const senderIds = [...senderMap.keys()];
    const [ownedSenders] = await connection.query(
      `SELECT id, name FROM senders
       WHERE telegram_account_id = ? AND id IN (${senderIds.map(() => '?').join(', ')})`,
      [accountId, ...senderIds]
    );
    if (ownedSenders.length !== senderIds.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'An exported sender does not belong to this account' });
    }

    const [result] = await connection.query(
      `INSERT INTO pdf_exports
         (user_id, telegram_account_id, conversation_type, telegram_chat_id,
          sender_id, channel_id, export_name, storage_key, file_size,
          first_message_id, last_message_id, message_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.auth.userId, accountId, type, chatId, senderId, channelId,
        exportName, storageKey, fileSize, firstMessageId, lastMessageId, messageCount]
    );
    for (const sender of ownedSenders) {
      await connection.query(
        `INSERT INTO pdf_export_senders
           (pdf_export_id, telegram_account_id, sender_id, sender_name_at_export, message_count)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, accountId, sender.id, sender.name, senderMap.get(String(sender.id))]
      );
    }
    await connection.commit();
    return res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'PDF export already exists' });
    console.error(`PDF export creation failed: user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(500).json({ error: 'Unable to save PDF export' });
  } finally {
    if (connection) connection.release();
  }
});

router.delete('/:id', async (req, res) => {
  const exportId = positiveId(req.params.id);
  if (!exportId) return res.status(404).json({ error: 'PDF export not found' });
  try {
    const [rows] = await pool.query(
      `SELECT storage_key, telegram_account_id, user_id FROM pdf_exports
       WHERE id = ? AND user_id = ? LIMIT 1`,
      [exportId, req.auth.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'PDF export not found' });
    await s3Media.deletePdfExportObject({
      storageKey: rows[0].storage_key,
      userId: rows[0].user_id,
      accountId: rows[0].telegram_account_id
    });
    const [result] = await pool.query(
      'DELETE FROM pdf_exports WHERE id = ? AND user_id = ?',
      [exportId, req.auth.userId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'PDF export not found' });
    return res.status(204).end();
  } catch (error) {
    console.error(`PDF export deletion failed: export=${exportId} user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(500).json({ error: 'Unable to delete PDF export' });
  }
});

module.exports = router;
module.exports._test = { positiveId, telegramChatId };
