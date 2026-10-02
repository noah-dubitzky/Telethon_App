'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { load, listen } = require('./approvalFixture.cjs');

async function fixture(t) {
  const users = new Map();
  const admin = { id: 1, auth_version: 0, password_hash: await bcrypt.hash('admin-password-123', 4) };
  const limits = new Map();
  let offline = false;
  let workerOffline = false;
  const stopped = [];
  const disconnected = [];
  const cancelled = [];
  const execute = async (sql, args = []) => {
    if (offline) throw new Error('database offline');
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('INSERT INTO users')) {
      if ([...users.values()].some(user => user.email === args[0])) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
      const id = users.size + 1;
      users.set(id, { id, email: args[0], password_hash: args[1], is_approved: 0, auth_version: 0, status: 'active', created_at: '2026-09-29' });
      return [{ insertId: id }];
    }
    if (q.startsWith('SELECT') && q.includes('FROM users')) {
      let values = [...users.values()];
      if (q.includes('WHERE email =')) values = values.filter(u => u.email === args[0]);
      else if (q.includes('WHERE id =')) values = values.filter(u => u.id === Number(args[0]));
      const columns = q.slice(7, q.indexOf(' FROM')).split(',').map(s => s.trim());
      return [values.map(u => Object.fromEntries(columns.map(c => [c, u[c]])))];
    }
    if (q.startsWith('UPDATE users SET auth_version')) {
      const user = users.get(Number(args[2]));
      if (user.is_approved && !args[0]) user.auth_version++;
      user.is_approved = Number(args[1]); return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT id FROM telegram_accounts')) return [[{ id: 11 }, { id: 12 }]];
    if (q.startsWith('UPDATE telegram_accounts SET connection_status')) return [{ affectedRows: 2 }];
    if (q.startsWith('DELETE FROM telegram_login_attempts')) return [{}];
    if (q.includes('FROM admins')) return [[{ ...admin }]];
    if (q.startsWith('DELETE FROM admin_login_limits')) return [{}];
    if (q.startsWith('INSERT INTO admin_login_limits')) { limits.set(args[0], (limits.get(args[0]) || 0) + 1); return [{}]; }
    if (q.startsWith('SELECT attempts FROM admin_login_limits')) return [[{ attempts: limits.get(args[0]) }]];
    throw new Error('Unhandled SQL: ' + q);
  };
  const pool = { execute, query: execute, getConnection: async () => ({ execute,
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) };
  const validity = load('services/sessionValidity.js', { '../public/scripts/db': pool });
  const requireAuth = load('middleware/requireAuth.js', { '../services/sessionValidity': validity });
  const approval = load('services/accountApproval.js', {
    '../public/scripts/db': pool,
    './telegramWorkerClient': { controlAccount: async (action, id) => { stopped.push([action, id]); if (workerOffline) throw new Error('offline'); } },
    './protectedStream': { cancelUserTransfers: id => cancelled.push(String(id)) }
  });
  const signup = require('./signupFixture.cjs')(execute);
  const app = express(); app.use(express.json());
  app.locals.realtime = { disconnectUser: async id => disconnected.push(String(id)) };
  const adminSession = session({ name: 'admin', secret: 'test-admin-session-secret', resave: false, saveUninitialized: false, cookie: { path: '/api/admin' } });
  app.use('/api/admin', adminSession, load('routes/admin.js', {
    '../public/scripts/db': pool, '../services/accountApproval': approval,
    '../middleware/requireAdmin': load('middleware/requireAdmin.js', { '../public/scripts/db': pool }),
    '../middleware/adminRateLimit': load('middleware/adminRateLimit.js', { '../public/scripts/db': pool })
  }));
  app.use(session({ name: 'user', secret: 'test-user-session-secret', resave: false, saveUninitialized: false }));
  app.use('/api/auth', load('routes/auth.js', { './signup': signup.router, '../public/scripts/db': pool, '../middleware/requireAuth': requireAuth, '../services/sessionValidity': validity }));
  app.get('/probe', requireAuth, (_req, res) => res.json({ ok: true }));
  const base = await listen(t, app);
  function client() {
    let cookie = ''; let csrf = '';
    return {
      cookie: () => cookie,
      async request(route, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
        const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', cookie, 'x-csrf-token': csrf, ...extra },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data, cookie: response.headers.get('set-cookie') };
      }
    };
  }
  return { signup, users, admin, client, validity, stopped, disconnected, cancelled,
    offline: value => { offline = value; }, workerOffline: value => { workerOffline = value; } };
}
async function adminLogin(f) {
  const client = f.client();
  assert.equal((await client.request('/api/admin/csrf')).status, 200);
  assert.equal((await client.request('/api/admin/login', { username: 'admin', password: 'admin-password-123' })).status, 200);
  return client;
}
const credentials = { email: 'user@example.com', password: 'user-password-123' };

test('registration, admin approval, multiple-session revocation, and fresh login after reapproval', async t => {
  const f = await fixture(t); const user = f.client();
  const requested = await user.request('/api/auth/signup/request-code', credentials);
  const registered = await user.request('/api/auth/register', { signupId: requested.data.signupId, code: f.signup.messages.at(-1).code, is_approved: true });
  assert.equal(registered.status, 201); assert.equal(registered.cookie, null);
  assert.equal(f.users.get(1).is_approved, 0); assert.equal(registered.data.user.password_hash, undefined);
  assert.equal((await user.request('/probe')).status, 401);
  assert.equal((await user.request('/api/auth/login', { ...credentials, password: 'wrong' })).status, 401);
  const pending = await user.request('/api/auth/login', credentials);
  assert.equal(pending.status, 403); assert.equal(pending.data.error, 'ACCOUNT_NOT_APPROVED'); assert.equal(pending.cookie, null);
  const admin = await adminLogin(f);
  assert.equal((await admin.request('/api/admin/users/1/approval', { isApproved: true }, 'PATCH')).status, 200);
  const listed = await admin.request('/api/admin/users');
  assert.deepEqual(Object.keys(listed.data.users[0]).sort(), ['created_at', 'email', 'id', 'is_approved']);
  assert.equal((await user.request('/api/auth/login', credentials)).status, 200);
  const second = f.client(); assert.equal((await second.request('/api/auth/login', credentials)).status, 200);
  assert.equal((await user.request('/probe')).status, 200);
  assert.equal((await user.request('/api/admin/users')).status, 401);
  const revoked = await admin.request('/api/admin/users/1/approval', { isApproved: false }, 'PATCH');
  assert.equal(revoked.status, 200); assert.equal(f.users.get(1).auth_version, 1);
  assert.deepEqual(f.stopped, [['pause', 11], ['pause', 12]]);
  assert.deepEqual(f.disconnected, ['1']); assert.deepEqual(f.cancelled, ['1']);
  assert.equal((await user.request('/probe')).status, 403);
  assert.equal((await user.request('/api/auth/login', credentials)).status, 403);
  await admin.request('/api/admin/users/1/approval', { isApproved: false }, 'PATCH');
  assert.equal(f.users.get(1).auth_version, 1, 'retry is idempotent');
  await admin.request('/api/admin/users/1/approval', { isApproved: true }, 'PATCH');
  assert.equal((await second.request('/probe')).status, 401, 'unused old cookie never revives');
  assert.equal((await second.request('/api/auth/login', credentials)).status, 200);
  assert.equal((await second.request('/probe')).status, 200);
});

test('admin CSRF, strict inputs, rate limits, logout and credential reset', async t => {
  const f = await fixture(t); const stranger = f.client();
  assert.equal((await stranger.request('/api/admin/login', { username: 'admin', password: 'admin-password-123' })).status, 403);
  const admin = await adminLogin(f);
  assert.equal((await admin.request('/api/admin/users/1/approval', { isApproved: true }, 'PATCH', { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await admin.request('/api/admin/users/1/approval', { isApproved: true }, 'PATCH', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await admin.request('/api/admin/users/1/approval', { isApproved: 'false' }, 'PATCH')).status, 400);
  assert.equal((await admin.request('/api/admin/users/999/approval', { isApproved: true }, 'PATCH')).status, 404);
  f.admin.auth_version++;
  assert.equal((await admin.request('/api/admin/users')).status, 401);
  const another = await adminLogin(f);
  assert.equal((await another.request('/api/admin/logout', {})).status, 200);
  assert.equal((await another.request('/api/admin/users')).status, 401);
  await stranger.request('/api/admin/csrf');
  let last;
  for (let i = 0; i < 11; i++) last = await stranger.request('/api/admin/login', { username: 'admin', password: 'wrong' });
  assert.equal(last.status, 429);
});

test('DB failure fails closed and failed worker notification does not restore approval', async t => {
  const f = await fixture(t); const user = f.client();
  const requested = await user.request('/api/auth/signup/request-code', credentials);
  await user.request('/api/auth/signup/verify', { signupId: requested.data.signupId, code: f.signup.messages.at(-1).code });
  const admin = await adminLogin(f);
  await admin.request('/api/admin/users/1/approval', { isApproved: true }, 'PATCH');
  await user.request('/api/auth/login', credentials);
  f.offline(true); assert.equal((await user.request('/probe')).status, 503); f.offline(false);
  f.workerOffline(true);
  const result = await admin.request('/api/admin/users/1/approval', { isApproved: false }, 'PATCH');
  assert.equal(result.status, 200); assert.equal(result.data.worker_pause_pending, true);
  assert.equal((await user.request('/probe')).status, 403);
});
