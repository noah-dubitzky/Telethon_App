const crypto = require('crypto');
const express = require('express');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');
const telegramAuthRateLimit = require('../middleware/telegramAuthRateLimit');
const { encryptSecret, decryptSecret } = require('../security/sessionEncryption');
const { callTelegramAuth } = require('../services/telegramAuthClient');

const router = express.Router();
const ATTEMPT_TTL_MINUTES = 10;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

router.use(requireAuth);

function safeError(res, error) {
  const mappings = {
    PHONE_INVALID: [400, 'Invalid Telegram phone number'],
    PHONE_CODE_INVALID: [400, 'Invalid Telegram verification code'],
    PHONE_CODE_EXPIRED: [410, 'Telegram verification code expired'],
    PASSWORD_INVALID: [400, 'Invalid Telegram password'],
    PASSWORD_REQUIRED: [409, 'Telegram password required'],
    FLOOD_WAIT: [429, 'Telegram rate limit reached'],
    TELEGRAM_SERVICE_UNAVAILABLE: [503, 'Telegram authentication service unavailable'],
    SERVICE_NOT_CONFIGURED: [503, 'Telegram authentication service unavailable'],
    ENCRYPTION_NOT_CONFIGURED: [503, 'Telegram connection storage is unavailable'],
    ENCRYPTION_KEY_VERSION_UNAVAILABLE: [503, 'Telegram connection storage is unavailable']
  };
  const [status, message] = mappings[error.code] || [502, 'Telegram authentication failed'];
  if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
  return res.status(status).json({ error: message, code: error.code || 'TELEGRAM_AUTH_FAILED' });
}

async function ownedAttempt(req, res) {
  const attemptId = String(req.body?.attempt_id || req.params?.attemptId || '');
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) {
    res.status(404).json({ error: 'Telegram login attempt not found' });
    return null;
  }
  const [rows] = await pool.execute(
    `SELECT id, user_id, phone_number, phone_code_hash_ciphertext,
            temporary_session_ciphertext, session_key_version, status, expires_at,
            expires_at <= NOW() AS is_expired
     FROM telegram_login_attempts
     WHERE id = ? AND user_id = ? LIMIT 1`,
    [attemptId, req.auth.userId]
  );
  const attempt = rows[0];
  if (!attempt) {
    res.status(404).json({ error: 'Telegram login attempt not found' });
    return null;
  }
  if (Number(attempt.is_expired) === 1) {
    await pool.execute('DELETE FROM telegram_login_attempts WHERE id = ? AND user_id = ?', [attemptId, req.auth.userId]);
    res.status(410).json({ error: 'Telegram login attempt expired' });
    return null;
  }
  return attempt;
}

async function finalizeConnection(userId, attempt, result) {
  const encryptedSession = encryptSecret(result.session);
  const displayName = result.identity.display_name || result.identity.username || `Telegram ${result.identity.id}`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute(
      `SELECT id, user_id FROM telegram_accounts WHERE telegram_user_id = ? LIMIT 1 FOR UPDATE`,
      [String(result.identity.id)]
    );
    let accountId;
    if (existing[0] && String(existing[0].user_id) !== String(userId)) {
      const error = new Error('Telegram account belongs to another user');
      error.code = 'TELEGRAM_ACCOUNT_ALREADY_LINKED';
      throw error;
    }
    if (existing[0]) {
      accountId = existing[0].id;
      await connection.execute(
        `UPDATE telegram_accounts
         SET display_name = ?, session_ciphertext = ?, session_key_version = ?,
             connection_status = 'connected', connected_at = NOW(), last_seen_at = NOW()
         WHERE id = ? AND user_id = ?`,
        [displayName, encryptedSession.ciphertext, encryptedSession.keyVersion, accountId, userId]
      );
    } else {
      const [inserted] = await connection.execute(
        `INSERT INTO telegram_accounts
           (user_id, telegram_user_id, display_name, session_ciphertext,
            session_key_version, connection_status, connected_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, 'connected', NOW(), NOW())`,
        [userId, String(result.identity.id), displayName, encryptedSession.ciphertext, encryptedSession.keyVersion]
      );
      accountId = inserted.insertId;
    }
    await connection.execute(
      'DELETE FROM telegram_login_attempts WHERE id = ? AND user_id = ?',
      [attempt.id, userId]
    );
    await connection.commit();
    return { id: accountId, telegram_user_id: String(result.identity.id), display_name: displayName, connection_status: 'connected' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.post('/start', telegramAuthRateLimit('start'), async (req, res) => {
  const phoneNumber = typeof req.body?.phone_number === 'string' ? req.body.phone_number.replace(/[\s()-]/g, '') : '';
  if (!PHONE_PATTERN.test(phoneNumber)) return res.status(400).json({ error: 'A valid international phone number is required' });
  try {
    const result = await callTelegramAuth('start', { phone_number: phoneNumber });
    const phoneHash = encryptSecret(result.phone_code_hash);
    const temporarySession = encryptSecret(result.temporary_session);
    const attemptId = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO telegram_login_attempts
         (id, user_id, phone_number, phone_code_hash_ciphertext,
          temporary_session_ciphertext, session_key_version, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'code_sent', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [attemptId, req.auth.userId, phoneNumber, phoneHash.ciphertext,
        temporarySession.ciphertext, temporarySession.keyVersion]
    );
    console.log(`Telegram login code sent: user=${req.auth.userId} attempt=${attemptId}`);
    return res.status(201).json({ attempt_id: attemptId, status: 'code_sent', expires_in_seconds: ATTEMPT_TTL_MINUTES * 60 });
  } catch (error) {
    console.error(`Telegram login start failed: user=${req.auth.userId} code=${error.code || 'unknown'}`);
    return safeError(res, error);
  }
});

router.post('/verify-code', telegramAuthRateLimit('code'), async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!/^\d{4,8}$/.test(code)) return res.status(400).json({ error: 'A valid Telegram verification code is required' });
  try {
    const attempt = await ownedAttempt(req, res);
    if (!attempt) return;
    const result = await callTelegramAuth('verify-code', {
      phone_number: attempt.phone_number,
      phone_code_hash: decryptSecret(attempt.phone_code_hash_ciphertext, attempt.session_key_version),
      temporary_session: decryptSecret(attempt.temporary_session_ciphertext, attempt.session_key_version),
      code
    });
    if (result.status === 'password_required') {
      const temporarySession = encryptSecret(result.temporary_session);
      await pool.execute(
        `UPDATE telegram_login_attempts
         SET temporary_session_ciphertext = ?, session_key_version = ?, status = 'password_required'
         WHERE id = ? AND user_id = ?`,
        [temporarySession.ciphertext, temporarySession.keyVersion, attempt.id, req.auth.userId]
      );
      return res.json({ attempt_id: attempt.id, status: 'password_required' });
    }
    const account = await finalizeConnection(req.auth.userId, attempt, result);
    console.log(`Telegram account connected: user=${req.auth.userId} attempt=${attempt.id} account=${account.id}`);
    return res.json({ status: 'connected', account });
  } catch (error) {
    if (error.code === 'TELEGRAM_ACCOUNT_ALREADY_LINKED' || error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Telegram account is already linked' });
    console.error(`Telegram code verification failed: user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return safeError(res, error);
  }
});

router.post('/verify-password', telegramAuthRateLimit('password'), async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) return res.status(400).json({ error: 'Telegram password is required' });
  try {
    const attempt = await ownedAttempt(req, res);
    if (!attempt) return;
    if (attempt.status !== 'code_sent') return res.status(409).json({ error: 'Telegram verification code is not expected for this attempt' });
    if (attempt.status !== 'password_required') return res.status(409).json({ error: 'Telegram password is not required for this attempt' });
    const result = await callTelegramAuth('verify-password', {
      temporary_session: decryptSecret(attempt.temporary_session_ciphertext, attempt.session_key_version),
      password
    });
    const account = await finalizeConnection(req.auth.userId, attempt, result);
    console.log(`Telegram account connected: user=${req.auth.userId} attempt=${attempt.id} account=${account.id}`);
    return res.json({ status: 'connected', account });
  } catch (error) {
    if (error.code === 'TELEGRAM_ACCOUNT_ALREADY_LINKED' || error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Telegram account is already linked' });
    console.error(`Telegram password verification failed: user=${req.auth.userId} reason=${error.code || 'unknown'}`);
    return safeError(res, error);
  }
});

router.get('/attempts/:attemptId', async (req, res) => {
  try {
    const attempt = await ownedAttempt(req, res);
    if (!attempt) return;
    return res.json({ attempt: { id: attempt.id, status: attempt.status, expires_at: attempt.expires_at } });
  } catch (error) {
    console.error(`Telegram attempt status failed: user=${req.auth.userId}`);
    return res.status(500).json({ error: 'Unable to retrieve Telegram login status' });
  }
});

module.exports = router;
