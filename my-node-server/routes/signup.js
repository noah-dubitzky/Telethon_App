'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { randomBytes, randomInt, createHash } = require('crypto');
const pool = require('../public/scripts/db');
const mail = require('../services/profileMail');
const fail = (status, message) => Object.assign(new Error(message), { status });
const handle = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await fn(req, res); } catch (error) {
    const duplicate = error.code === 'ER_DUP_ENTRY';
    res.status(duplicate ? 409 : error.status || 503).json({ error: duplicate
      ? 'An account with that email already exists' : error.status ? error.message : 'Signup is temporarily unavailable. Please try again.' });
  }
};
async function limit(req, email) {
  await pool.execute('DELETE FROM signup_limits WHERE resets_at <= NOW() LIMIT 100');
  for (const [key, max] of [[`ip:${req.ip}`, 30], ...(email ? [[`email:${email}`, 5]] : [])]) {
    const bucket = createHash('sha256').update(key).digest('hex');
    await pool.execute(`INSERT INTO signup_limits (bucket, attempts, resets_at)
      VALUES (?, 1, DATE_ADD(NOW(), INTERVAL 15 MINUTE))
      ON DUPLICATE KEY UPDATE attempts = IF(resets_at <= NOW(), 1, attempts + 1),
      resets_at = IF(resets_at <= NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE), resets_at)`, [bucket]);
    const [rows] = await pool.execute('SELECT attempts FROM signup_limits WHERE bucket = ?', [bucket]);
    if (rows[0].attempts > max) throw fail(429, 'Too many requests. Try again in 15 minutes.');
  }
}
async function deliver(email, code) {
  await mail.send(email, 'Verify your TeleSaver email', `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`);
}
router.post('/signup/request-code', handle(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw fail(400, 'A valid email address is required');
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) throw fail(400, 'Password must be at least 12 characters and at most 72 bytes');
  await limit(req, email);
  if (!mail.configured()) throw fail(503, 'Email delivery is not configured. Please contact the administrator.');
  const [users] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (users.length) throw fail(409, 'An account with that email already exists');
  await pool.execute('DELETE FROM pending_signups WHERE expires_at <= NOW() LIMIT 100');
  const id = randomBytes(32).toString('hex');
  const code = String(randomInt(1000000)).padStart(6, '0');
  const passwordHash = await bcrypt.hash(password, 12);
  const codeHash = await bcrypt.hash(code, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT INTO pending_signups (id, email, password_hash, code_hash, expires_at)
      VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`, [id, email, passwordHash, codeHash]);
    await deliver(email, code);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.json({ signupId: id, resendAfter: 60 });
}));
async function pending(req, action) {
  const id = req.body?.signupId;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw fail(400, 'Request an email verification code first');
  await limit(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`SELECT *, expires_at <= NOW() AS expired,
      TIMESTAMPDIFF(SECOND, sent_at, NOW()) AS age FROM pending_signups WHERE id = ? FOR UPDATE`, [id]);
    if (!rows[0]) throw fail(400, 'Signup has expired or was completed. Start again.');
    const result = await action(connection, rows[0]);
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
router.post('/signup/cancel', handle(async (req, res) => {
  const id = req.body?.signupId;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw fail(400, 'Invalid signup identifier');
  await pool.execute('DELETE FROM pending_signups WHERE id = ?', [id]);
  res.json({ ok: true });
}));
router.post('/signup/resend-code', handle(async (req, res) => {
  await pending(req, async (connection, row) => {
    if (row.age < 60 || row.sends >= 5) throw fail(429, 'Wait at least 60 seconds between codes. A signup allows up to five emails.');
    const code = String(randomInt(1000000)).padStart(6, '0');
    const hash = await bcrypt.hash(code, 12);
    await connection.execute(`UPDATE pending_signups SET code_hash = ?, sent_at = NOW(),
      expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), sends = sends + 1 WHERE id = ?`, [hash, row.id]);
    await deliver(row.email, code);
  });
  res.json({ resendAfter: 60 });
}));
// Keep the old endpoint protected as well; credentials alone never create a user.
router.post(['/signup/verify', '/register'], handle(async (req, res) => {
  if (!/^\d{6}$/.test(String(req.body?.code || ''))) throw fail(400, 'Enter the six-digit verification code');
  const result = await pending(req, async (connection, row) => {
    if (row.expired) throw fail(400, 'Code expired. Request another code.');
    if (row.attempts >= 5) throw fail(429, 'Too many incorrect codes. Start signup again.');
    if (!await bcrypt.compare(String(req.body.code), row.code_hash)) {
      await connection.execute('UPDATE pending_signups SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      return null; // Commit failed attempts, rather than rolling them back.
    }
    const [insert] = await connection.execute(`INSERT INTO users (email, password_hash, status, is_approved, email_verified_at)
      VALUES (?, ?, 'active', FALSE, NOW())`, [row.email, row.password_hash]);
    await connection.execute('DELETE FROM pending_signups WHERE id = ?', [row.id]);
    return { id: insert.insertId, email: row.email };
  });
  if (!result) throw fail(400, 'Incorrect verification code');
  res.status(201).json({ user: result, approval_pending: true, message: 'Your account has been created and is awaiting administrator approval.' });
}));
module.exports = router;
