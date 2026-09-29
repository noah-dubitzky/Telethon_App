'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const pool = require('../public/scripts/db');
const requireAdmin = require('../middleware/requireAdmin');
const csrf = require('../middleware/adminCsrf');
const limit = require('../middleware/adminRateLimit');
const { setApproval } = require('../services/accountApproval');
const router = express.Router();
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// An anonymous CSRF token is also required for login (prevents login CSRF).
router.get('/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
});
router.use(csrf);
router.post('/login', limit, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!/^[a-z0-9._-]{1,100}$/.test(username) || typeof password !== 'string' || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'Invalid administrator credentials' });
  }
  try {
    const [rows] = await pool.execute('SELECT id, password_hash, auth_version FROM admins WHERE username = ? LIMIT 1', [username]);
    const matches = await bcrypt.compare(password, rows[0]?.password_hash || dummyHash);
    if (!matches || !rows[0]) return res.status(401).json({ error: 'Invalid administrator credentials' });
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.adminId = rows[0].id;
    req.session.adminAuthVersion = Number(rows[0].auth_version);
    req.session.csrfToken = randomBytes(32).toString('hex');
    await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    res.json({ csrfToken: req.session.csrfToken });
  } catch (_) { res.status(503).json({ error: 'Unable to log in as administrator' }); }
});
router.use(requireAdmin);
router.get('/me', (req, res) => res.json({ authenticated: true, csrfToken: req.session.csrfToken }));
router.post('/logout', (req, res) => req.session.destroy(error => {
  if (error) return res.status(503).json({ error: 'Unable to log out' });
  res.clearCookie('telesaver.admin.sid', { path: '/api/admin', httpOnly: true,
    secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ ok: true });
}));
router.get('/users', async (req, res) => {
  const page = Number(req.query.page || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) return res.status(400).json({ error: 'Invalid page' });
  try {
    const [rows] = await pool.query(`SELECT id, email, is_approved, created_at FROM users ORDER BY id DESC LIMIT 101 OFFSET ?`, [page * 100]);
    res.json({ users: rows.slice(0, 100), has_more: rows.length > 100 });
  } catch (_) { res.status(503).json({ error: 'Unable to list users' }); }
});
router.patch('/users/:id/approval', async (req, res) => {
  if (!/^[1-9]\d{0,19}$/.test(req.params.id) || typeof req.body?.isApproved !== 'boolean') {
    return res.status(400).json({ error: 'A valid user ID and boolean isApproved are required' });
  }
  try { res.json(await setApproval(req.params.id, req.body.isApproved, req.app.locals.realtime)); }
  catch (error) { res.status(error.status || 503).json({ error: error.status === 404 ? 'User not found' : 'Unable to change approval' }); }
});
module.exports = router;
