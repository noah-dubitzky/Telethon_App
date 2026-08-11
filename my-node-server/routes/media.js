const express = require('express');
const path = require('path');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const uploadsRoot = path.resolve(__dirname, '..', 'public', 'uploads');

router.use(requireAuth);
router.get('/*', async (req, res) => {
  try {
    const relativePath = String(req.params[0] || '').replace(/\\/g, '/');
    const absolutePath = path.resolve(uploadsRoot, relativePath);
    if (!relativePath || (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`) && absolutePath !== uploadsRoot)) {
      return res.status(404).json({ error: 'Media not found' });
    }
    const publicPath = `/uploads/${relativePath}`;
    const [rows] = await pool.query(
      `SELECT md.id FROM media md
       JOIN messages m ON m.id = md.message_id
       JOIN telegram_accounts ta ON ta.id = m.telegram_account_id AND ta.user_id = ?
       WHERE REPLACE(md.path, '\\\\', '/') IN (?, ?, ?) LIMIT 1`,
      [req.auth.userId, publicPath, publicPath.slice(1), `my-node-server/public${publicPath}`]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Media not found' });
    return res.sendFile(absolutePath, err => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Media not found' });
    });
  } catch (err) {
    console.error('Media lookup failed:', err?.code || 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve media' });
  }
});

module.exports = router;
