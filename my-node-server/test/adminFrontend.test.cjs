'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { listen } = require('./approvalFixture.cjs');

test('admin browser flow logs in, safely lists users, approves, revokes and logs out', async t => {
  const { default: puppeteer } = await import('puppeteer');
  let authenticated = false;
  let approved = false;
  const app = express(); app.use(express.json());
  app.get('/api/admin/csrf', (_req, res) => res.json({ csrfToken: 'test-token' }));
  app.post('/api/admin/login', (req, res) => {
    assert.equal(req.get('x-csrf-token'), 'test-token');
    authenticated = true; res.json({ csrfToken: 'test-token' });
  });
  app.get('/api/admin/me', (_req, res) => res.status(authenticated ? 200 : 401).json(
    authenticated ? { authenticated: true } : { error: 'Administrator authentication required' }));
  app.get('/api/admin/users', (_req, res) => res.json({ users: [
    { id: 1, email: '<img src=x onerror="window.injected=true">', is_approved: Number(approved), created_at: '2026-09-29' }
  ], has_more: false }));
  app.patch('/api/admin/users/1/approval', (req, res) => { approved = req.body.isApproved; res.json({ is_approved: approved }); });
  app.post('/api/admin/logout', (_req, res) => { authenticated = false; res.json({ ok: true }); });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const base = await listen(t, app);
  const browser = await puppeteer.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/admin');
  await page.waitForSelector('#loginPanel:not([hidden])');
  await page.type('[name=username]', 'admin'); await page.type('[name=password]', 'test-password-123');
  await page.click('#loginForm button');
  await page.waitForSelector('#dashboard:not([hidden]) #users button');
  assert.equal(await page.$eval('#users td:nth-child(2)', node => node.textContent), '<img src=x onerror="window.injected=true">');
  assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
  await page.click('#users button');
  await page.waitForFunction(() => document.querySelector('#users button')?.textContent === 'Revoke Access');
  assert.equal(approved, true);
  await page.click('#users button');
  await page.waitForFunction(() => document.querySelector('#users button')?.textContent === 'Approve');
  assert.equal(approved, false);
  await page.click('#logout'); await page.waitForSelector('#loginPanel:not([hidden])');
  assert.equal(authenticated, false); assert.deepEqual(errors, []);
});
