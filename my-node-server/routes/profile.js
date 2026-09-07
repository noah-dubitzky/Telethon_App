'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const rateLimit = require('../middleware/profileRateLimit');
const mail = require('../services/profileMail');
const router = express.Router();
const hash = code => crypto.createHash('sha256').update(code).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

router.use(requireAuth);
// Require JSON and reject cross-site browser requests for all mutations.
router.use((req, res, next) => {
  if (req.method !== 'GET' && (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site')) {
    return res.status(403).json({ error: 'This request must be made from your TeleSaver profile.' });
  }
  next();
});

function handle(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email address is unavailable.' });
      if (!error.status) console.error('Profile update failed:', error.code || 'unknown error');
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to update your profile. Please try again.' });
    }
  };
}

async function transaction(req, fn, checkPassword = false) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id, email, password_hash, auth_version, status FROM users WHERE id = ? FOR UPDATE', [req.auth.userId]);
    const user = rows[0];
    if (!user || user.status !== 'active' || Number(user.auth_version) !== Number(req.session.authVersion ?? 0)) {
      throw fail(401, 'Please sign in again.');
    }
    if (checkPassword && (typeof req.body.current_password !== 'string'
      || !await bcrypt.compare(req.body.current_password, user.password_hash))) {
      throw fail(400, 'Your current password is incorrect.');
    }
    const result = await fn(connection, user);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function refreshSession(req, version) {
  const userId = req.auth.userId;
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = userId;
  req.session.authVersion = version;
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  if (req.app.locals.realtime) {
    await req.app.locals.realtime.disconnectOtherSessions(userId, req.sessionID);
  }
}

router.get('/', handle(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT new_email, UNIX_TIMESTAMP(expires_at) AS expires_at_unix
     FROM user_email_changes WHERE user_id = ? AND expires_at > NOW() AND attempts < 5`, [req.auth.userId]
  );
  res.json({ email_change_available: mail.configured(), pending_email: rows[0] || null });
}));

router.patch('/name', rateLimit('profile-name', 30), handle(async (req, res) => {
  const name = typeof req.body.display_name === 'string' ? req.body.display_name.trim() : '';
  if (!name || Array.from(name).length > 100 || /[\x00-\x1f\x7f]/.test(name)) {
    throw fail(400, 'Enter a display name between 1 and 100 characters.');
  }
  await transaction(req, connection => connection.execute('UPDATE users SET display_name = ? WHERE id = ?', [name, req.auth.userId]));
  res.json({ message: 'Display name updated.' });
}));

router.post('/password', rateLimit('profile-password'), handle(async (req, res) => {
  const password = req.body.new_password;
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw fail(400, 'Use at least 12 characters and no more than 72 UTF-8 bytes for your new password.');
  }
  if (password !== req.body.confirm_password) throw fail(400, 'The new passwords do not match.');
  const version = await transaction(req, async (connection, user) => {
    if (await bcrypt.compare(password, user.password_hash)) throw fail(400, 'Choose a password different from your current password.');
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', [passwordHash, user.id]);
    await connection.execute('DELETE FROM user_email_changes WHERE user_id = ?', [user.id]);
    return Number(user.auth_version) + 1;
  }, true);
  try { await refreshSession(req, version); }
  catch (_) { return res.json({ message: 'Password updated. Please sign in again with your new password.', sign_in_required: true }); }
  res.json({ message: 'Password updated. Other login sessions have been signed out.' });
}));

router.post('/email', rateLimit('profile-email', 3), handle(async (req, res) => {
  if (!mail.configured()) throw fail(503, 'Email changes are unavailable right now. Please try again later.');
  const email = typeof req.body.new_email === 'string' ? req.body.new_email.trim().toLowerCase() : '';
  if (email.length > 320 || !/^[^\s@<>(),;:\\"]+@[^\s@<>(),;:\\"]+\.[^\s@<>(),;:\\"]+$/.test(email)) {
    throw fail(400, 'Enter a valid email address.');
  }
  const code = String(crypto.randomInt(10000000, 100000000));
  const codeHash = hash(code);
  await transaction(req, async (connection, user) => {
    if (email === user.email) throw fail(400, 'Enter a different email address.');
    const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) throw fail(409, 'That email address is unavailable.');
    await connection.execute(
      `INSERT INTO user_email_changes (user_id, new_email, code_hash, expires_at, attempts)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE), 0)
       ON DUPLICATE KEY UPDATE new_email = VALUES(new_email), code_hash = VALUES(code_hash),
         expires_at = VALUES(expires_at), attempts = 0`, [user.id, email, codeHash]
    );
  }, true);
  try {
    await mail.send(email, 'Verify your TeleSaver email address', `Your TeleSaver verification code is ${code}.\n\nEnter it in your Profile tab within 15 minutes. Your current login email stays active until verification succeeds.\n\nIf you did not request this change, ignore this email.`);
  } catch (_) {
    await pool.execute('DELETE FROM user_email_changes WHERE user_id = ? AND code_hash = ?', [req.auth.userId, codeHash]);
    throw fail(503, 'We could not send the verification email. Your login email has not changed. Please try again later.');
  }
  res.json({ message: 'Verification code sent. Your current login email stays active until you verify the new address.', pending_email: { new_email: email } });
}));

router.post('/email/verify', rateLimit('profile-email-code'), handle(async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!/^\d{8}$/.test(code)) throw fail(400, 'Enter the eight-digit verification code.');
  const result = await transaction(req, async (connection, user) => {
    const [rows] = await connection.execute(
      'SELECT *, expires_at > NOW() AS unexpired FROM user_email_changes WHERE user_id = ? FOR UPDATE', [user.id]
    );
    const pending = rows[0];
    if (!pending || !pending.unexpired || pending.attempts >= 5) throw fail(400, 'This code has expired or is no longer valid. Request a new code.');
    if (!crypto.timingSafeEqual(Buffer.from(hash(code), 'hex'), Buffer.from(pending.code_hash, 'hex'))) {
      await connection.execute('UPDATE user_email_changes SET attempts = attempts + 1 WHERE user_id = ?', [user.id]);
      return { invalid: true };
    }
    await connection.execute('UPDATE users SET email = ?, auth_version = auth_version + 1 WHERE id = ?', [pending.new_email, user.id]);
    await connection.execute('DELETE FROM user_email_changes WHERE user_id = ?', [user.id]);
    return { oldEmail: user.email, version: Number(user.auth_version) + 1 };
  });
  if (result.invalid) throw fail(400, 'The verification code is incorrect.');
  let notificationFailed = false;
  try { await mail.send(result.oldEmail, 'Your TeleSaver login email changed', 'Your TeleSaver login email was changed after password confirmation and verification of the new address. If you did not make this change, contact your TeleSaver administrator immediately.'); }
  catch (_) { notificationFailed = true; console.error('Profile email-change notification delivery failed'); }
  const message = 'Email updated. Use your new email address next time you sign in.';
  try { await refreshSession(req, result.version); }
  catch (_) { return res.json({ message, sign_in_required: true, notification_failed: notificationFailed }); }
  res.json({ message, notification_failed: notificationFailed });
}));

router.delete('/email', handle(async (req, res) => {
  await transaction(req, connection => connection.execute('DELETE FROM user_email_changes WHERE user_id = ?', [req.auth.userId]));
  res.json({ message: 'Email change cancelled. Your login email has not changed.' });
}));

module.exports = router;
