const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../public/scripts/db');
const service = require('../services/retention');
const router = express.Router();
router.use(require('../middleware/requireAuth'));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', async (req, res) => {
  try { res.json({ settings: await service.get(req.auth.userId) }); }
  catch (_) { res.status(503).json({ error: 'Unable to load retention settings.' }); }
});
router.post('/preview', async (req, res) => {
  let settings;
  try { settings = service.validate(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const before = await service.get(req.auth.userId);
    const counts = await service.preview(req.auth.userId, settings);
    const token = randomUUID();
    req.session.retentionPreview = { token, userId: String(req.auth.userId), before: service.fingerprint(before), after: service.fingerprint(settings), expires: Date.now() + 300000 };
    res.json({ counts, confirmation_required: service.shortened(before, settings), token });
  } catch (_) { res.status(503).json({ error: 'Unable to calculate deletion counts.' }); }
});
router.put('/', async (req, res) => {
  let settings;
  try { settings = service.validate(req.body?.settings); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  let db;
  try {
    db = await pool.getConnection();
    await db.beginTransaction();
    const before = await service.get(req.auth.userId, db, true);
    if (service.shortened(before, settings)) {
      const preview = req.session.retentionPreview;
      if (!preview || preview.token !== req.body.confirmation_token || preview.userId !== String(req.auth.userId) || preview.expires < Date.now() ||
        preview.before !== service.fingerprint(before) || preview.after !== service.fingerprint(settings)) {
        await db.rollback();
        return res.status(409).json({ error: 'Please preview and confirm the shorter retention periods again.' });
      }
    }
    await db.execute(`UPDATE user_storage_settings SET ${service.fields.map(key => `${key} = ?`).join(', ')} WHERE user_id = ?`, [...service.fields.map(key => settings[key]), req.auth.userId]);
    await db.commit();
    delete req.session.retentionPreview;
    res.json({ settings });
  } catch (_) {
    if (db) await db.rollback().catch(() => {});
    res.status(503).json({ error: 'Unable to save retention settings.' });
  } finally { if (db) db.release(); }
});
module.exports = router;
