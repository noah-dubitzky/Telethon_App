'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { load, listen } = require('./approvalFixture.cjs');

test('Telegram authorization finishing after revoke/reapprove cannot attach an account using an old session', async t => {
  const attempt = { id: '11111111-1111-1111-1111-111111111111', user_id: 1, is_expired: 0, phone_number: '+15555555555' };
  let writes = 0;
  let rolledBack = false;
  const pool = {
    execute: async () => [[attempt]],
    getConnection: async () => ({
      beginTransaction: async () => {}, release() {}, rollback: async () => { rolledBack = true; },
      execute: async (sql, args) => {
        if (sql.includes('SELECT id FROM users')) {
          assert.match(sql, /auth_version = \? FOR UPDATE/); assert.deepEqual(args, [1, 0]);
          return [[]]; // Owner has since advanced to version 1.
        }
        writes++; throw new Error('Unexpected write');
      }
    })
  };
  const app = express(); app.use(express.json());
  app.use('/connect', load('routes/telegram-connect.js', {
    '../public/scripts/db': pool,
    '../middleware/requireAuth': (req, _res, next) => { req.auth = { userId: 1 }; req.session = { authVersion: 0 }; next(); },
    '../middleware/telegramAuthRateLimit': () => (_req, _res, next) => next(),
    '../security/sessionEncryption': { encryptSecret: () => ({}), decryptSecret: () => 'secret' },
    '../services/telegramAuthClient': { callTelegramAuth: async () => ({ status: 'connected', session: 'session', identity: { id: 123 } }) },
    '../services/telegramWorkerClient': { controlAccount: async () => { throw new Error('Must not start'); } }
  }));
  const base = await listen(t, app);
  const response = await fetch(base + '/connect/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attempt.id, code: '12345' }) });
  assert.equal(response.status, 403); assert.equal((await response.json()).error, 'ACCOUNT_NOT_APPROVED');
  assert.equal(rolledBack, true); assert.equal(writes, 0);
});

test('worker APIs reject suspended owners, deny ingestion from old generations, and allow stop acknowledgments', async t => {
  let approved = false;
  let ingests = 0;
  const execute = async sql => {
    if (sql.includes('SELECT u.auth_version')) return [approved ? [{ auth_version: 2 }] : []];
    if (sql.includes('SELECT u.is_approved')) return [[{ is_approved: Number(approved), status: 'active', auth_version: 2 }]];
    if (sql.includes('UPDATE telegram_accounts SET connection_status')) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT id, user_id')) return [[{ id: 11, user_id: 1, telegram_user_id: '123', session_ciphertext: 'encrypted' }]];
    ingests++;
    throw new Error('Unexpected write or query');
  };
  const pool = { execute, getConnection: async () => ({ execute,
    beginTransaction: async () => {}, rollback: async () => {}, release() {} }) };
  const requireWorker = (req, res, next) => req.get('x-worker') === 'trusted' ? next() : res.status(401).json({ error: 'Unauthorized' });
  const mocks = {
    '../public/scripts/db': pool, '../middleware/requireWorker': requireWorker,
    '../public/utils/filterRules': { isMessageAllowed: async () => true },
    '../security/sessionEncryption': { decryptSecret: () => 'saved-session' },
    '../services/workerEligibility': load('services/workerEligibility.js', { '../public/scripts/db': pool })
  };
  const app = express(); app.use(express.json());
  app.use('/internal/worker', load('routes/worker.internal.js', mocks));
  app.use('/messages', load('routes/messages.post.js', mocks));
  const base = await listen(t, app);
  const request = (url, body, method = body === undefined ? 'GET' : 'POST') => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', 'x-worker': 'trusted' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  for (const path of ['/accounts/11', '/accounts/11/storage-settings']) {
    assert.equal((await request('/internal/worker' + path)).status, 403);
  }
  assert.equal((await request('/internal/worker/filters/check', { telegram_account_id: 11 })).status, 403);
  assert.equal((await request('/internal/worker/accounts/11/status', { status: 'connected' }, 'PATCH')).status, 403);
  assert.equal((await request('/internal/worker/accounts/11/status', { status: 'disconnected' }, 'PATCH')).status, 200);
  const message = { telegram_account_id: 11, auth_version: 2, timestamp: '2026-09-29 12:00:00', text: 'denied' };
  assert.equal((await request('/messages', message)).status, 403);
  approved = true;
  assert.equal((await request('/messages', { ...message, auth_version: 1 })).status, 403);
  assert.equal((await request('/messages', { ...message, auth_version: undefined })).status, 403);
  const account = await request('/internal/worker/accounts/11');
  assert.equal(account.status, 200); assert.equal((await account.json()).account.auth_version, 2);
  assert.equal(ingests, 0);
});
