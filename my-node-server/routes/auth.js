const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../public/scripts/db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_USER_COLUMNS = 'id, email, status, created_at, updated_at';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateCredentialsInput(email, password, isRegistration = false) {
  if (!email || !EMAIL_PATTERN.test(email) || email.length > 320) {
    return 'A valid email address is required';
  }
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required';
  }
  if (isRegistration && password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (
    error ? reject(error) : resolve()
  )));
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (
    error ? reject(error) : resolve()
  )));
}

router.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const validationError = validateCredentialsInput(email, password, true);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash, status)
       VALUES (?, ?, 'active')`,
      [email, passwordHash]
    );
    const [users] = await pool.execute(
      `SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`,
      [result.insertId]
    );

    await regenerateSession(req);
    req.session.userId = result.insertId;
    await saveSession(req);
    return res.status(201).json({ user: users[0] });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error('Registration failed:', error && error.code ? error.code : 'unknown error');
    return res.status(500).json({ error: 'Unable to create account' });
  }
});

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const validationError = validateCredentialsInput(email, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const [users] = await pool.execute(
      `SELECT id, email, password_hash, status, created_at, updated_at
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
    const user = users[0];
    const passwordMatches = Boolean(
      user && user.password_hash && await bcrypt.compare(password, user.password_hash)
    );
    if (!passwordMatches || user.status !== 'active') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    const { password_hash: _passwordHash, ...safeUser } = user;
    return res.json({ user: safeUser });
  } catch (error) {
    console.error('Login failed:', error && error.code ? error.code : 'unknown error');
    return res.status(500).json({ error: 'Unable to log in' });
  }
});

router.post('/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie(req.app.locals.sessionCookieName, req.app.locals.sessionCookieClearOptions);
    return res.json({ ok: true });
  }

  const sessionId = req.sessionID;
  return req.session.destroy((error) => {
    if (error) {
      console.error('Logout failed: session destruction error');
      return res.status(500).json({ error: 'Unable to log out' });
    }
    res.clearCookie(req.app.locals.sessionCookieName, req.app.locals.sessionCookieClearOptions);
    if (req.app.locals.realtime) {
      req.app.locals.realtime.disconnectSession(sessionId).catch(() => {
        console.error('Logout socket disconnect failed');
      });
    }
    return res.json({ ok: true });
  });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ? AND status = 'active' LIMIT 1`,
      [req.auth.userId]
    );
    if (!users[0]) {
      return req.session.destroy(() => res.status(401).json({ error: 'Authentication required' }));
    }
    return res.json({ user: users[0] });
  } catch (error) {
    console.error('Current-user lookup failed:', error && error.code ? error.code : 'unknown error');
    return res.status(500).json({ error: 'Unable to retrieve current user' });
  }
});

module.exports = router;
