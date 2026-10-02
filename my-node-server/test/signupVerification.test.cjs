const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listen } = require('./approvalFixture.cjs');
const credentials = { email: 'person@example.com', password: 'long-test-password' };
async function fixture(t) {
  const users = [];
  const f = require('./signupFixture.cjs')(async (sql, args) => {
    if (sql.startsWith('SELECT id FROM users')) return [users.filter(u => u.email === args[0])];
    if (sql.startsWith('INSERT INTO users')) { users.push({ email: args[0] }); return [{ insertId: users.length }]; }
    throw new Error(sql);
  });
  const app = express(); app.use(express.json()); app.use(f.router);
  const base = await listen(t, app);
  const post = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { ...f, post, users };
}
test('verification is required, wrong codes do not create users, valid codes are single use', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/register', credentials)).status, 400);
  const { data } = await f.post('/signup/request-code', credentials);
  assert.equal(f.users.length, 0);
  const code = f.messages[0].code;
  assert.equal((await f.post('/signup/verify', { signupId: data.signupId, code: code === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal(f.pending.get(data.signupId).attempts, 1);
  const result = await f.post('/signup/verify', { signupId: data.signupId, code, email: 'attacker@example.com' });
  assert.equal(result.status, 201); assert.equal(result.data.approval_pending, true);
  assert.equal(f.users[0].email, credentials.email);
  assert.equal((await f.post('/signup/verify', { signupId: data.signupId, code })).status, 400);
  assert.equal(f.users.length, 1);
});
test('resend cooldown, expiry, replacement, failed mail rollback, and attempt ceiling', async t => {
  const f = await fixture(t);
  const { data: { signupId } } = await f.post('/signup/request-code', credentials);
  const first = f.messages[0].code;
  assert.equal((await f.post('/signup/resend-code', { signupId })).status, 429);
  f.pending.get(signupId).expired = 1;
  assert.equal((await f.post('/signup/verify', { signupId, code: first })).status, 400);
  f.pending.get(signupId).age = 61;
  f.failDelivery(true);
  const originalHash = f.pending.get(signupId).code_hash;
  assert.equal((await f.post('/signup/resend-code', { signupId })).status, 503);
  assert.equal(f.pending.get(signupId).code_hash, originalHash);
  f.failDelivery(false);
  assert.equal((await f.post('/signup/resend-code', { signupId })).status, 200);
  assert.notEqual(f.pending.get(signupId).code_hash, originalHash);
  const current = f.messages.at(-1).code;
  for (let i = 0; i < 5; i++) assert.equal((await f.post('/signup/verify', { signupId, code: current === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal((await f.post('/signup/verify', { signupId, code: current })).status, 429);
  assert.equal(f.users.length, 0);
});
test('failed initial email leaves no signup, cancellation invalidates the code', async t => {
  const f = await fixture(t); f.failDelivery(true);
  assert.equal((await f.post('/signup/request-code', credentials)).status, 503);
  assert.equal(f.pending.size, 0);
  f.failDelivery(false);
  const { data: { signupId } } = await f.post('/signup/request-code', credentials);
  assert.equal((await f.post('/signup/cancel', { signupId })).status, 200);
  assert.equal((await f.post('/signup/cancel', { signupId })).status, 200, 'reset succeeds even when the pending signup no longer exists');
  assert.equal((await f.post('/signup/verify', { signupId, code: f.messages[0].code })).status, 400);
});
