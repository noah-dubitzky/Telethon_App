const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input id="conversationSearch"><p id="conversationNoResults" hidden>no results</p><section id="messages"><div data-message-date>2026-09-14</div><div data-message-row><article class="message"><p class="text">Hello WORLD</p><span class="time">09:30 AM</span></article></div><div data-message-row><article class="message"><p class="text">Other text</p><span class="time">02:45 PM</span></article></div><div data-message-date>2026-09-15</div><div data-message-row><article class="message"><p class="text">world again</p><span class="time">09:30 AM</span></article></div></section>`);
    let requests = 0;
    page.on('request', () => { requests += 1; });
    await page.addScriptTag({ path: path.join(__dirname, '../public/scripts/conversation_search.js') });
    async function search(value) {
      return page.evaluate(value => {
        const input = document.getElementById('conversationSearch');
        input.value = value;
        input.dispatchEvent(new Event('input'));
        return {
          rows: [...document.querySelectorAll('[data-message-row]')].map(e => !e.hidden),
          dates: [...document.querySelectorAll('[data-message-date]')].map(e => !e.hidden),
          empty: !document.getElementById('conversationNoResults').hidden
        };
      }, value);
    }
    assert.deepEqual(await search('WORLD'), { rows: [true, false, true], dates: [true, true], empty: false });
    assert.deepEqual(await search('Other'), { rows: [false, true, false], dates: [true, false], empty: false });
    assert.deepEqual(await search('missing'), { rows: [false, false, false], dates: [false, false], empty: true });
    assert.deepEqual(await search(''), { rows: [true, true, true], dates: [true, true], empty: false });
    assert.deepEqual(await search('09:30'), { rows: [true, false, true], dates: [true, true], empty: false });
    assert.deepEqual(await search('pm'), { rows: [false, true, false], dates: [true, false], empty: false });
    assert.deepEqual(await search('2026-09-14'), { rows: [true, true, false], dates: [true, false], empty: false });
    assert.deepEqual(await search('2026-09-15 09:30 AM'), { rows: [false, false, true], dates: [false, true], empty: false });
    await search('missing');
    await page.evaluate(() => document.getElementById('messages').insertAdjacentHTML('beforeend', '<div data-message-row><article class="message"><p class="text">missing match</p></article></div>'));
    await page.waitForFunction(() => document.getElementById('conversationNoResults').hidden);
    assert.equal(await page.$$eval('[data-message-row].visible', rows => rows.length), 1);
    await page.focus('#conversationSearch');
    await page.keyboard.press('Enter');
    assert.equal(requests, 0, 'Filtering and Enter must not send HTTP requests');
    console.log('PASS: matching, date labels, no results, clearing, live rows, and zero HTTP requests');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
