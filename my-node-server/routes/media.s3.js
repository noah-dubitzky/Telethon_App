const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const s3Media = require('../services/s3Media');

const router = express.Router();
const uploadsRoot = path.resolve(__dirname, '..', 'public', 'uploads');
const allowedTypes = new Set(['images', 'videos', 'audio', 'documents', 'stickers', 'voice', 'other']);

router.use(requireAuth);

function validId(value) {
  return /^\d+$/.test(String(value || '')) && String(value) !== '0';
}

const OWNED_MEDIA_SQL = `
  SELECT md.id, md.path, md.s3_key, md.original_filename, md.display_name,
         md.mime_type, md.file_size, md.media_type,
         m.telegram_account_id, ta.user_id
  FROM media md
  JOIN messages m ON m.id = md.message_id
  JOIN telegram_accounts ta ON ta.id = m.telegram_account_id
  WHERE md.id = ? AND ta.user_id = ?`;

async function ownedMedia(executor, mediaId, userId, { forUpdate = false } = {}) {
  const [rows] = await executor.execute(
    `${OWNED_MEDIA_SQL} LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [mediaId, userId]
  );
  return rows[0] || null;
}

function legacyUrl(storedPath) {
  const normalized = String(storedPath || '').replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('/uploads/');
  if (marker >= 0) return normalized.slice(marker);
  if (normalized.startsWith('uploads/')) return `/${normalized}`;
  return null;
}

function legacyAbsolutePath(storedPath) {
  const url = legacyUrl(storedPath);
  if (!url) return null;
  const absolute = path.resolve(uploadsRoot, url.slice('/uploads/'.length));
  return absolute.startsWith(`${uploadsRoot}${path.sep}`) ? absolute : null;
}

async function access(req, res, { redirect = false } = {}) {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Media not found' });
  try {
    const media = await ownedMedia(pool, req.params.id, req.auth.userId);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    let url;
    let storage;
    let expiresIn = null;
    if (media.s3_key) {
      expiresIn = Math.min(Math.max(Number(process.env.S3_PRESIGN_SECONDS || 300), 60), 900);
      url = await s3Media.createAccessUrl(media, { expiresIn });
      storage = 's3';
    } else {
      url = legacyUrl(media.path);
      storage = 'local';
      if (!url) return res.status(404).json({ error: 'Media not found' });
    }
    res.set('Cache-Control', 'private, no-store');
    if (redirect) return res.redirect(302, url);
    return res.json({ media_id: media.id, storage, url, expires_in: expiresIn });
  } catch (error) {
    console.error(`Media access failed: media=${req.params.id} user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(502).json({ error: 'Unable to retrieve media' });
  }
}

router.get('/:id/access', (req, res) => access(req, res));
router.get('/:id/content', (req, res) => access(req, res, { redirect: true }));

router.patch('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Media not found' });
  const displayName = req.body?.display_name;
  if (displayName !== null && (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 255)) {
    return res.status(400).json({ error: 'display_name must be null or 1-255 characters' });
  }
  try {
    const media = await ownedMedia(pool, req.params.id, req.auth.userId);
    if (!media) return res.status(404).json({ error: 'Media not found' });
    await pool.execute(
      `UPDATE media md
       JOIN messages m ON m.id = md.message_id
       JOIN telegram_accounts ta ON ta.id = m.telegram_account_id AND ta.user_id = ?
       SET md.display_name = ? WHERE md.id = ?`,
      [req.auth.userId, displayName === null ? null : displayName.trim(), req.params.id]
    );
    return res.json({ media_id: Number(req.params.id), display_name: displayName === null ? null : displayName.trim() });
  } catch (error) {
    console.error(`Media metadata update failed: media=${req.params.id} user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return res.status(500).json({ error: 'Unable to update media' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Media not found' });
  let connection;
  let externalDeleted = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const media = await ownedMedia(connection, req.params.id, req.auth.userId, { forUpdate: true });
    if (!media) {
      await connection.rollback();
      return res.status(404).json({ error: 'Media not found' });
    }
    if (media.s3_key) {
      await s3Media.deleteObject(media);
      externalDeleted = true;
    } else if (media.path) {
      const absolute = legacyAbsolutePath(media.path);
      if (!absolute) throw Object.assign(new Error('Unsafe legacy media path'), { code: 'INVALID_MEDIA_PATH' });
      await fs.unlink(absolute).catch(error => { if (error.code !== 'ENOENT') throw error; });
      externalDeleted = true;
    }
    await connection.execute('DELETE FROM media WHERE id = ?', [media.id]);
    await connection.commit();
    return res.status(204).end();
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(`Media deletion failed: media=${req.params.id} user=${req.auth.userId} external_deleted=${externalDeleted} reason=${error.code || 'unknown'}`);
    return res.status(502).json({ error: 'Unable to delete media; retry is safe' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
module.exports._test = { legacyAbsolutePath, legacyUrl, validId };
