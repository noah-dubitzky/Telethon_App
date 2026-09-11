// Run manually: node test/settings.browser.cjs (requires Chrome).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const user = { id: 42, email: 'tester@example.com', status: 'active', created_at: '2026-01-01 07:00:00', created_at_unix: 1767268800, updated_at: null };
    let pendingEmail = null;
    let passwordRequests = 0;
    let storageSettings = { save_text: true, save_photos: true, save_videos: true, save_audio: true, save_files: true, save_pdfs: true, max_file_size_mb: null };
    let retention = { text_retention_days: null, media_retention_days: null, pdf_retention_days: null };
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      const json = body => request.respond({ contentType: 'application/json', body: JSON.stringify(body) });
      if (url.hostname === 'cdn.tailwindcss.com') return request.respond({ contentType: 'application/javascript', body: '' });
      if (url.hostname === 'code.jquery.com') return request.respond({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '../public/scripts/jquery-3.0.0.min.js')) });
      if (url.pathname === '/api/auth/me') return json({ user });
      if (url.pathname === '/api/retention/preview') return json({ confirmation_required: true, token: 'preview-token', counts: { text: 12, media: 3, pdfs: 2 } });
      if (url.pathname === '/api/retention') {
        if (request.method() === 'PUT') retention = JSON.parse(request.postData()).settings;
        return json({ settings: retention });
      }
      if (url.pathname === '/api/storage/settings') {
        if (request.method() === 'PUT') storageSettings = JSON.parse(request.postData());
        return json({ settings: storageSettings });
      }
      if (url.pathname === '/api/storage') return json({ text_bytes: 100, media_bytes: 700, pdf_bytes: 200, total_bytes: 1000, updated_at: '2026-09-07T12:00:00Z' });
      if (url.pathname === '/api/auth/profile') return json({ email_change_available: true, pending_email: pendingEmail });
      if (url.pathname === '/api/auth/profile/name') {
        user.display_name = JSON.parse(request.postData()).display_name;
        return json({ message: 'Display name updated.' });
      }
      if (url.pathname === '/api/auth/profile/password') {
        passwordRequests++;
        if (JSON.parse(request.postData()).current_password === 'wrong') return request.respond({ status: 400, contentType: 'application/json', body: '{"error":"Your current password is incorrect."}' });
        return json({ message: 'Password updated.' });
      }
      if (url.pathname === '/api/auth/profile/email') {
        if (request.method() === 'DELETE') { pendingEmail = null; return json({ message: 'Email change cancelled.' }); }
        pendingEmail = { new_email: JSON.parse(request.postData()).new_email };
        return json({ message: 'Verification code sent.', pending_email: pendingEmail });
      }
      if (url.pathname === '/api/auth/profile/email/verify') {
        user.email = pendingEmail.new_email;
        pendingEmail = null;
        return json({ message: 'Email updated.' });
      }
      if (url.pathname === '/api/telegram-accounts') return json({ accounts: [{ id: 1, display_name: '<Test account>', phone_number: '+15551234567', connection_status: 'connected', archive_enabled: true }] });
      if (url.pathname.endsWith('/start')) return json({ attempt_id: 'test' });
      if (url.pathname.endsWith('/verify-code')) return json({ status: 'password_required' });
      if (url.pathname.endsWith('/verify-password')) return json({ account: { id: 1 } });
      const file = path.join(__dirname, '../public', url.pathname);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return request.respond({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html', body: fs.readFileSync(file) });
      request.abort();
    });
    await page.goto('http://telesaver.test/settings.html');
    await page.waitForFunction(() => document.querySelector('#accountCount').textContent === '1');
    await page.addStyleTag({ content: '.hidden{display:none}' });
    assert.match(await page.$eval('#accountList', e => e.textContent), /<Test account>/);
    assert.doesNotMatch(await page.$eval('#accountList', e => e.textContent), /15551234567/);
    await page.click('#profileTab');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('#storageTotal').textContent === '1 KB');
    assert.equal(await page.$eval('#storageTab', e => e.getAttribute('aria-selected')), 'true');
    assert.match(await page.$eval('#storagePdf', e => e.textContent), /200 B.*20.0%/);
    await page.waitForFunction(() => !document.querySelector('#storageSettingsFields').disabled);
    await page.click('[name="save_videos"]');
    await page.type('#storageFileLimit', '25');
    await page.click('#saveStorageSettings');
    await page.waitForFunction(() => document.querySelector('#storageSettingsStatus').textContent.startsWith('Storage settings saved.'));
    assert.equal(storageSettings.save_videos, false);
    assert.equal(storageSettings.max_file_size_mb, 25);
    await page.waitForFunction(() => !document.querySelector('#retentionFields').disabled);
    await page.select('#textRetention', '30');
    await page.click('#retentionForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#retentionDialog').open);
    assert.equal(await page.$eval('#retentionTextCount', e => e.textContent), '12');
    assert.equal(await page.$eval('#retentionMediaCount', e => e.textContent), '3');
    assert.equal(await page.$eval('#retentionPdfCount', e => e.textContent), '2');
    await page.click('#cancelRetention');
    assert.equal(retention.text_retention_days, null);
    await page.click('#retentionForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#retentionDialog').open);
    await page.click('#confirmRetention');
    await page.waitForFunction(() => document.querySelector('#retentionStatus').textContent === 'Retention settings saved.');
    assert.equal(retention.text_retention_days, 30);
    await page.click('#refreshStorage');
    await page.waitForFunction(() => !document.querySelector('#refreshStorage').disabled);
    await page.click('#profileTab');
    assert.equal(await page.$eval('#profileTab', e => e.getAttribute('aria-selected')), 'true');
    await page.waitForFunction(() => !document.querySelector('#profileDetails').classList.contains('hidden'));
    assert.equal(await page.$eval('#profileTab', e => e.textContent), 'Profile');
    assert.equal(await page.$eval('#profileId', e => e.textContent), '42');
    assert.equal(await page.$eval('#profileStatus', e => e.textContent), 'active');
    assert.equal(await page.$eval('#profileCreated', e => e.dateTime), '2026-01-01T12:00:00.000Z');
    assert.equal(await page.$eval('#profileUpdated', e => e.textContent), 'Not available');
    await page.click('[data-profile-edit="name"]');
    await page.type('[name=display_name]', '<Noah>');
    await page.click('#saveProfileEdit');
    await page.waitForFunction(() => document.querySelector('#profileName').textContent === '<Noah>');
    assert.equal(await page.$eval('#profileName', e => e.children.length), 0);
    await page.click('[data-profile-edit="password"]');
    await page.type('[name=current_password]', 'wrong');
    await page.type('[name=new_password]', 'new-password-123');
    await page.type('[name=confirm_password]', 'not-matching-123');
    await page.click('#saveProfileEdit');
    assert.equal(passwordRequests, 0, 'mismatched passwords stay in the form');
    await page.$eval('[name=confirm_password]', e => { e.value = 'new-password-123'; });
    await page.click('#saveProfileEdit');
    await page.waitForFunction(() => document.querySelector('#profileEditError').textContent.includes('incorrect'));
    assert.equal(await page.$eval('[name=current_password]', e => e.value), '');
    await page.click('#cancelProfileEdit');
    await page.waitForFunction(() => !document.querySelector('#profileDialog').open);
    await page.click('[data-profile-edit="email"]');
    await page.type('[name=new_email]', 'new@example.com');
    await page.type('[name=current_password]', 'old-password-123');
    await page.click('#saveProfileEdit');
    await page.waitForFunction(() => !document.querySelector('#pendingEmail').classList.contains('hidden'));
    assert.equal(user.email, 'tester@example.com', 'requesting verification preserves login email');
    await page.reload();
    await page.addStyleTag({ content: '.hidden{display:none}' });
    await page.click('#profileTab');
    await page.waitForFunction(() => !document.querySelector('#pendingEmail').classList.contains('hidden'));
    await page.click('#verifyEmailButton');
    await page.type('[name=code]', '12345678');
    await page.click('#saveProfileEdit');
    await page.waitForFunction(() => document.querySelector('[data-user-email]').textContent === 'new@example.com');
    await page.focus('#profileTab');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval('#accountsTab', e => e.getAttribute('aria-selected')), 'true');
    await page.click('#connectButton');
    for (const [form, field, value, next] of [
      ['phoneForm', 'phone', '+15551234567', 'codeForm'],
      ['codeForm', 'code', '12345', 'passwordForm'],
    ]) {
      await page.type(`[name=${field}]`, value);
      await page.click(`#${form} button`);
      await page.waitForFunction(id => !document.getElementById(id).classList.contains('hidden'), {}, next);
    }
    await page.type('[name=password]', 'test-password');
    await page.click('#passwordForm button');
    await page.waitForFunction(() => !document.querySelector('#connectDialog').open && !document.querySelector('#settingsMessage').classList.contains('hidden'));
    assert.equal(await page.$eval('[name=password]', e => e.value), '');
    await page.setViewport({ width: 390, height: 844 });
    await page.click('#connectButton');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#connectDialog').open);
    assert.deepEqual(errors, []);
    console.log('Settings browser checks passed (mock APIs and CSS; no live Telegram login).');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
