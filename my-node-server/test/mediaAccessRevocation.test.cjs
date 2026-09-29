'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Readable } = require('node:stream');
const { load, listen } = require('./approvalFixture.cjs');
const { mergePolicy } = require('../scripts/secure-s3-access');

async function fixture(t) {
  let approved = true; let reads = 0; let range; let long = false; let source;
  const validity = { isSessionValid: async () => approved, NOT_APPROVED: { error: 'ACCOUNT_NOT_APPROVED' } };
  const s3 = {
    safeDownloadName: require('../services/s3Media').safeDownloadName,
    readObject: async (_media, requestedRange) => {
      reads++; range = requestedRange;
      if (long) {
        source = new Readable({ read() {} }); source.push('first chunk');
        return { Body: source };
      }
      return { Body: Readable.from(['hello']), ContentLength: 5, ...(range ? { ContentRange: 'bytes 0-4/10' } : {}) };
    }
  };
  const stream = load('services/protectedStream.js', { './sessionValidity': validity, './s3Media': s3 });
  const media = { id: 1, user_id: 1, telegram_account_id: 2, s3_key: 'users/1/telegram_accounts/2/images/file', mime_type: 'image/png', original_filename: 'photo.png' };
  const pool = {
    execute: async (_sql, args) => [[...(String(args[0]) === '1' && Number(args[1]) === 1 ? [media] : [])]],
    query: async (_sql, args) => [[...(String(args[0]) === '1' && Number(args[1]) === 1
      ? [{ storage_key: media.s3_key, export_name: 'export.pdf', telegram_account_id: 2, user_id: 1 }] : [])]]
  };
  const auth = (req, res, next) => {
    if (!req.get('x-test-user')) return res.status(401).json({ error: 'Authentication required' });
    if (!approved) return res.status(403).json(validity.NOT_APPROVED);
    req.auth = { userId: Number(req.get('x-test-user')) }; req.session = { userId: req.auth.userId, authVersion: 0 }; next();
  };
  const mocks = { '../public/scripts/db': pool, '../middleware/requireAuth': auth,
    '../services/s3Media': s3, '../services/protectedStream': stream };
  const app = express();
  app.use('/api/media', load('routes/media.s3.js', mocks));
  app.use('/api/pdf-exports', load('routes/pdf.exports.js', mocks));
  const base = await listen(t, app);
  return { base, stream, reads: () => reads, range: () => range, source: () => source,
    suspend: () => { approved = false; }, long: () => { long = true; } };
}

test('media and PDF links remain authenticated; suspension denies an already obtained URL', async t => {
  const f = await fixture(t);
  const headers = { 'x-test-user': '1' };
  const access = await fetch(f.base + '/api/media/1/access', { headers });
  const data = await access.json(); assert.equal(data.url, '/api/media/1/content');
  assert.equal(f.reads(), 0); assert.equal(data.expires_in, null);
  assert.equal((await fetch(f.base + data.url)).status, 401);
  assert.equal((await fetch(f.base + data.url, { headers: { 'x-test-user': '2' } })).status, 404);
  const response = await fetch(f.base + data.url, { headers: { ...headers, range: 'bytes=0-4' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-range'), 'bytes 0-4/10'); assert.equal(await response.text(), 'hello');
  assert.equal(f.range(), 'bytes=0-4');
  const pdf = await fetch(f.base + '/api/pdf-exports/1/content', { headers });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); await pdf.text();
  const before = f.reads(); f.suspend();
  assert.equal((await fetch(f.base + data.url, { headers })).status, 403);
  assert.equal((await fetch(f.base + '/api/pdf-exports/1/content', { headers })).status, 403);
  assert.equal(f.reads(), before);
});

test('local revocation aborts a running stream and destroys its S3 body', async t => {
  const f = await fixture(t); f.long();
  const response = await fetch(f.base + '/api/media/1/content', { headers: { 'x-test-user': '1' } });
  const reader = response.body.getReader(); assert.equal((await reader.read()).done, false);
  const next = reader.read(); f.suspend(); f.stream.cancelUserTransfers(1);
  await assert.rejects(next); assert.equal(f.source().destroyed, true);
});

test('running stream rechecks database state without a local revocation signal', async t => {
  const f = await fixture(t); f.long();
  const response = await fetch(f.base + '/api/media/1/content', { headers: { 'x-test-user': '1' } });
  const reader = response.body.getReader(); await reader.read(); f.suspend();
  await assert.rejects(reader.read()); assert.equal(f.source().destroyed, true);
});

test('invalid byte ranges never reach S3', async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/api/media/1/content', { headers: { 'x-test-user': '1', range: 'bytes=0-2,4-6' } });
  assert.equal(response.status, 416); assert.equal(f.reads(), 0);
});

test('S3 cutover policy preserves existing rules and denies old signed reads including versions', () => {
  const existing = { Sid: 'Existing', Effect: 'Allow', Action: 's3:PutObject' };
  const policy = mergePolicy({ Version: '2012-10-17', Statement: [existing] }, 'test-bucket');
  assert.deepEqual(policy.Statement[0], existing);
  const deny = policy.Statement[1]; assert.equal(deny.Effect, 'Deny');
  assert.equal(deny.Condition.StringEquals['s3:authType'], 'REST-QUERY-STRING');
  assert.deepEqual(deny.Action, ['s3:GetObject', 's3:GetObjectVersion']);
  assert.equal(deny.Resource, 'arn:aws:s3:::test-bucket/users/*');
  assert.deepEqual(mergePolicy(policy, 'test-bucket'), policy);
});
