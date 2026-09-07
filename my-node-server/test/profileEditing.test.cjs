'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

function load(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const mod = { exports: {} };
  const realRequire = createRequire(filename);
  const requireMock = name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(requireMock, mod, mod.exports);
  return mod.exports;
}

async function fixture(t) {
  let user = { id: 1, email: 'old@example.com', display_name: null, password_hash: await bcrypt.hash('old-password-123', 4), status: 'active', auth_version: 0 };
  let pending = null;
  const limits = new Map();
  const sent = [];
  let mailEnabled = true;
  let mailFails = false;
  let duplicate = false;
  let snapshot;
  const execute = async (sql, args = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('INSERT INTO user_security_limits')) { limits.set(args[1], (limits.get(args[1]) || 0) + 1); return [{}]; }
    if (q.startsWith('SELECT attempts FROM user_security_limits')) return [[{ attempts: limits.get(args[1]) }]];
    if (q.startsWith('SELECT') && q.includes('FROM users')) {
      if (q.startsWith('SELECT id FROM users WHERE email')) return [duplicate ? [{ id: 2 }] : []];
      if (q.includes('WHERE email =') && args[0] !== user.email) return [[]];
      if (q.includes('WHERE id =') && Number(args[0]) !== user.id) return [[]];
      const safe = { id: user.id, email: user.email, display_name: user.display_name, status: user.status };
      if (q.includes('password_hash')) safe.password_hash = user.password_hash;
      if (q.includes('auth_version')) safe.auth_version = user.auth_version;
      return [[safe]];
    }
    if (q.startsWith('UPDATE users SET display_name')) { user.display_name = args[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE users SET password_hash')) { user.password_hash = args[0]; user.auth_version++; return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE users SET email')) {
      if (duplicate) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      user.email = args[0]; user.auth_version++; return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO user_email_changes')) { pending = { user_id: args[0], new_email: args[1], code_hash: args[2], attempts: 0, unexpired: 1 }; return [{}]; }
    if (q.startsWith('SELECT') && q.includes('FROM user_email_changes')) return [pending ? [{ ...pending }] : []];
    if (q.startsWith('UPDATE user_email_changes SET attempts')) { pending.attempts++; return [{}]; }
    if (q.startsWith('DELETE FROM user_email_changes')) {
      if (!args[1] || args[1] === pending?.code_hash) pending = null;
      return [{}];
    }
    throw new Error('Unhandled fixture SQL: ' + q);
  };
  const pool = { execute, getConnection: async () => ({
    execute,
    beginTransaction: async () => { snapshot = structuredClone({ user, pending }); },
    commit: async () => {},
    rollback: async () => { user = snapshot.user; pending = snapshot.pending; },
    release() {}
  }) };
  const validity = load('services/sessionValidity.js', { '../public/scripts/db': pool });
  const requireAuth = load('middleware/requireAuth.js', { '../services/sessionValidity': validity });
  const rateLimit = load('middleware/profileRateLimit.js', { '../public/scripts/db': pool });
  const mail = { configured: () => mailEnabled, send: async (to, subject, text) => { if (mailFails) throw new Error('offline'); sent.push({ to, subject, text }); } };
  const mocks = { '../public/scripts/db': pool, '../middleware/requireAuth': requireAuth, '../middleware/profileRateLimit': rateLimit, '../services/profileMail': mail };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-only-session-secret-for-profile-checks', resave: false, saveUninitialized: false }));
  app.use('/api/auth', load('routes/auth.js', mocks));
  app.use('/api/auth/profile', load('routes/profile.js', mocks));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  function client() {
    let cookie = '';
    return async (route, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
      const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  }
  const owner = client();
  assert.equal((await owner('/login', { email: user.email, password: 'old-password-123' })).status, 200);
  return { owner, client, sent, user: () => user, pending: () => pending, validity,
    setMailEnabled: value => { mailEnabled = value; }, setMailFails: value => { mailFails = value; },
    setDuplicate: value => { duplicate = value; }, expire: () => { pending.unexpired = 0; },
    code: () => sent.filter(message => message.subject.startsWith('Verify')).at(-1).text.match(/\b\d{8}\b/)[0]
  };
}

test('profile edits require authentication, validate names, and never expose hashes', async t => {
  const f = await fixture(t);
  assert.equal((await f.client()('/profile/name', { display_name: 'A' }, 'PATCH')).status, 401);
  assert.equal((await f.owner('/profile/name', { display_name: ' ' }, 'PATCH')).status, 400);
  assert.equal((await f.owner('/profile/name', { display_name: 'A' }, 'PATCH', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.owner('/profile/name', { display_name: '  Noah  ', id: 999 }, 'PATCH')).status, 200);
  const me = await f.owner('/me');
  assert.equal(me.body.user.display_name, 'Noah');
  assert.equal(me.body.user.id, 1);
  assert.equal(me.body.user.password_hash, undefined);
  assert.equal(me.body.user.auth_version, undefined);
});

test('password changes validate credentials, revoke other sessions, and cancel pending email', async t => {
  const f = await fixture(t);
  const other = f.client();
  await other('/login', { email: 'old@example.com', password: 'old-password-123' });
  await f.owner('/profile/email', { new_email: 'new@example.com', current_password: 'old-password-123' });
  const change = { current_password: 'wrong', new_password: 'new-password-456', confirm_password: 'new-password-456' };
  assert.equal((await f.owner('/profile/password', change)).status, 400);
  assert.equal(f.user().auth_version, 0);
  change.current_password = 'old-password-123';
  assert.equal((await f.owner('/profile/password', { ...change, confirm_password: 'mismatch' })).status, 400);
  assert.equal((await f.owner('/profile/password', { ...change, new_password: 'short', confirm_password: 'short' })).status, 400);
  assert.equal((await f.owner('/profile/password', change)).status, 200);
  assert.equal(await bcrypt.compare(change.new_password, f.user().password_hash), true);
  assert.equal(f.pending(), null);
  assert.equal((await other('/me')).status, 401);
  assert.equal((await f.owner('/me')).status, 200);
  assert.equal((await f.client()('/login', { email: 'old@example.com', password: 'old-password-123' })).status, 401);
  assert.equal((await f.client()('/login', { email: 'old@example.com', password: change.new_password })).status, 200);
});

test('email is unchanged until verification; successful codes are single use', async t => {
  const f = await fixture(t);
  assert.equal((await f.owner('/profile/email', { new_email: 'NEW@example.com', current_password: 'old-password-123' })).status, 200);
  assert.equal(f.user().email, 'old@example.com');
  const code = f.code();
  assert.notEqual(f.pending().code_hash, code);
  assert.equal((await f.owner('/profile/email/verify', { code })).status, 200);
  assert.equal(f.user().email, 'new@example.com');
  assert.equal(f.sent.at(-1).to, 'old@example.com');
  assert.equal((await f.owner('/me')).status, 200);
  assert.equal((await f.owner('/profile/email/verify', { code })).status, 400);
  assert.equal((await f.client()('/login', { email: 'new@example.com', password: 'old-password-123' })).status, 200);
});

test('email delivery failures and missing SMTP leave the old login active', async t => {
  const f = await fixture(t);
  const body = { new_email: 'new@example.com', current_password: 'old-password-123' };
  f.setMailEnabled(false);
  assert.equal((await f.owner('/profile')).body.email_change_available, false);
  assert.equal((await f.owner('/profile/email', body)).status, 503);
  f.setMailEnabled(true); f.setMailFails(true);
  assert.equal((await f.owner('/profile/email', body)).status, 503);
  assert.equal(f.pending(), null);
  assert.equal(f.user().email, 'old@example.com');
});

test('wrong verification codes consume attempts and lock out after five', async t => {
  const f = await fixture(t);
  await f.owner('/profile/email', { new_email: 'new@example.com', current_password: 'old-password-123' });
  const code = f.code();
  for (let n = 0; n < 5; n++) assert.equal((await f.owner('/profile/email/verify', { code: '00000000' })).status, 400);
  assert.equal(f.pending().attempts, 5);
  assert.equal((await f.owner('/profile/email/verify', { code })).status, 400);
  assert.equal(f.user().email, 'old@example.com');
});

test('expired, cancelled, and superseded codes cannot change the email', async t => {
  const f = await fixture(t);
  const body = { new_email: 'new@example.com', current_password: 'old-password-123' };
  await f.owner('/profile/email', body);
  const first = f.code();
  await f.owner('/profile/email', body);
  assert.equal((await f.owner('/profile/email/verify', { code: first })).status, 400);
  f.expire();
  assert.equal((await f.owner('/profile/email/verify', { code: f.code() })).status, 400);
  await f.owner('/profile/email', body);
  assert.equal((await f.owner('/profile/email', {}, 'DELETE')).status, 200);
  assert.equal((await f.owner('/profile/email/verify', { code: f.code() })).status, 400);
  assert.equal(f.user().email, 'old@example.com');
});

test('duplicate email at verification rolls back the change', async t => {
  const f = await fixture(t);
  await f.owner('/profile/email', { new_email: 'new@example.com', current_password: 'old-password-123' });
  f.setDuplicate(true);
  assert.equal((await f.owner('/profile/email/verify', { code: f.code() })).status, 409);
  assert.equal(f.user().email, 'old@example.com');
  assert.equal(f.user().auth_version, 0);
  assert.ok(f.pending());
});

test('sensitive password attempts are rate limited and old session versions fail closed', async t => {
  const f = await fixture(t);
  const body = { current_password: 'wrong', new_password: 'new-password-456', confirm_password: 'new-password-456' };
  for (let i = 0; i < 10; i++) assert.equal((await f.owner('/profile/password', body)).status, 400);
  assert.equal((await f.owner('/profile/password', body)).status, 429);
  assert.equal(await f.validity.isSessionValid({ userId: 1 }), true);
  assert.equal(await f.validity.isSessionValid({ userId: 1, authVersion: 99 }), false);
  assert.equal(await f.validity.isSessionValid({ userId: 999 }), false);
});
