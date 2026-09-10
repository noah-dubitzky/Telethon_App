const express = require('express');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const s3Media = require('../services/s3Media');
const router = express.Router();
const cache = new Map();
const pending = new Map();
const ttl = 60000;

async function calculate(userId) {
  const [textResult, pdfResult] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(OCTET_LENGTH(m.text)), 0) AS bytes
      FROM messages m JOIN telegram_accounts ta ON ta.id = m.telegram_account_id
      WHERE ta.user_id = ?`, [userId]),
    pool.query(`SELECT md.s3_key FROM media md
      JOIN messages m ON m.id = md.message_id
      JOIN telegram_accounts ta ON ta.id = m.telegram_account_id
      WHERE ta.user_id = ? AND md.s3_key IS NOT NULL
        AND LOWER(SUBSTRING_INDEX(md.mime_type, ';', 1)) = 'application/pdf'`, [userId])
  ]);
  const { mediaBytes, pdfBytes } = await s3Media.storageTotals(userId, new Set(pdfResult[0].map(row => row.s3_key)));
  const textBytes = Number(textResult[0][0].bytes);
  const result = { text_bytes: textBytes, media_bytes: mediaBytes, pdf_bytes: pdfBytes,
    total_bytes: textBytes + mediaBytes + pdfBytes, updated_at: new Date().toISOString() };
  for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
  if (cache.size >= 1000) cache.delete(cache.keys().next().value);
  cache.set(userId, { result, expires: Date.now() + ttl });
  return result;
}

router.get('/', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const userId = String(req.auth.userId);
  try {
    const cached = cache.get(userId);
    if (req.query.refresh !== '1' && cached && cached.expires > Date.now()) return res.json(cached.result);
    if (!pending.has(userId)) pending.set(userId, calculate(userId).finally(() => pending.delete(userId)));
    return res.json(await pending.get(userId));
  } catch (error) {
    console.error(`Storage overview failed: user=${userId} reason=${error.code || error.name || 'unknown'}`);
    return res.status(503).json({ error: 'Unable to calculate storage. Please try again.' });
  }
});

router.get('/settings', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ settings: await require('../services/storageSettings').get(req.auth.userId) });
  } catch (_) { res.status(503).json({ error: 'Unable to load storage settings.' }); }
});

router.put('/settings', requireAuth, async (req, res) => {
  const service = require('../services/storageSettings');
  let settings;
  try { settings = service.validate(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    await service.save(req.auth.userId, settings);
    res.json({ settings });
  } catch (_) { res.status(503).json({ error: 'Unable to save storage settings.' }); }
});

module.exports = router;
