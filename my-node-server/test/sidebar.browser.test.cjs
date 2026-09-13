const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

// Exercise the real page markup and shared sidebar with synthetic session data.
// Other page controllers and external requests are isolated from this UI test.
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const root = path.resolve(__dirname, '../public');
    const jquery = fs.readFileSync(path.join(root, 'scripts/jquery-3.0.0.min.js'), 'utf8');
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.hostname === 'cdn.tailwindcss.com') return request.continue();
      if (request.resourceType() === 'document') {
        return request.respond({ contentType: 'text/html', body: fs.readFileSync(path.join(root, url.pathname), 'utf8') });
      }
      if (url.pathname.includes('jquery')) return request.respond({ contentType: 'application/javascript', body: jquery });
      if (url.pathname === '/scripts/sidebar.js') {
        return request.respond({ contentType: 'application/javascript', body: fs.readFileSync(path.join(root, 'scripts/sidebar.js'), 'utf8') });
      }
      if (url.pathname.endsWith('/session_guard.js')) {
        return request.respond({ contentType: 'application/javascript', body: "window.telesaverUser = {email: 'sidebar-test@example.test'};" });
      }
      return request.respond({ contentType: 'application/javascript', body: '' });
    });
    const pages = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html') && fs.readFileSync(path.join(root, file), 'utf8').includes('session_guard.js'));
    for (const file of pages) {
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(`http://sidebar.test/${file.replaceAll('\\', '/')}?telegram_account_id=42`);
      await page.waitForSelector('#navigationSidebar');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#navigationSidebar')).position === 'fixed');
      assert.equal(await page.$$eval('#navigationSidebar', nodes => nodes.length), 1, file);
      assert.equal(await page.$eval('#navigationSidebar [data-user-email]', el => el.textContent), 'sidebar-test@example.test', file);
      assert.equal(await page.$eval('body', el => getComputedStyle(el).paddingLeft), '256px', file);
      assert.equal(await page.$$eval('#sidebarLinks [aria-current]', nodes => nodes.length), 1, file);
      assert.equal(await page.$$eval('#sidebarLinks a', links => links.some(el => el.href.includes('/filters.html'))), false, file);
      await page.setViewport({ width: 390, height: 700 });
      await page.click('#openSidebar');
      assert.equal(await page.$eval('#navigationSidebar', el => el.getAttribute('aria-modal')), 'true', file);
      await page.$eval('#navigationSidebar [data-logout]', el => el.focus());
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'sidebarHome', file);
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-logout')), true, file);
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#openSidebar', el => el.getAttribute('aria-expanded')), 'false', file);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'openSidebar', file);
      await page.click('#openSidebar');
      await page.click('#sidebarBackdrop', { offset: { x: 380, y: 300 } });
      assert.equal(await page.$eval('#openSidebar', el => el.getAttribute('aria-expanded')), 'false', file);
      await page.click('#openSidebar');
      await page.setViewport({ width: 1280, height: 400 });
      await page.waitForFunction(() => !document.querySelector('#navigationSidebar').hasAttribute('aria-modal'));
      assert.equal(await page.$$eval('[inert]', nodes => nodes.length), 0, file);
      assert.equal(await page.$eval('#navigationSidebar', el => getComputedStyle(el).overflowY), 'auto', file);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('telesaver:authenticated', { detail: { email: 'later@example.test' } })));
      assert.equal(await page.$eval('#navigationSidebar [data-user-email]', el => el.textContent), 'later@example.test', file);
      console.log(`PASS ${file}`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
