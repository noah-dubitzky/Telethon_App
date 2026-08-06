const express = require('express');
const router = express.Router();

function sanitizeFilenamePart(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);

  return cleaned || fallback;
}

function getContentDisposition(filename) {
  const asciiFallback = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim() || 'messages.pdf';
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

function getRequestOrigin(req) {
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

router.get('/channel-pdf', async (req, res) => {
  let browser;

  try {
    const entityId = String(req.query.id || '').trim();
    const entityName = String(req.query.name || '').trim();
    const entityType = req.query.type === 'sender' ? 'sender' : 'channel';
    const view = req.query.view === 'mobile' ? 'mobile' : 'desktop';

    if (!entityId) {
      return res.status(400).json({ error: `Missing ${entityType} id.` });
    }

    const puppeteer = require('puppeteer');
    const pageName = entityType === 'sender' ? 'sender.html' : 'channels.html';
    const pagePath = view === 'mobile' ? `/mobile/${pageName}` : `/${pageName}`;
    const pageUrl = new URL(pagePath, getRequestOrigin(req));
    pageUrl.searchParams.set('id', entityId);
    if (entityName) pageUrl.searchParams.set('name', entityName);
    if (entityType === 'sender') {
      pageUrl.searchParams.set('external_id', String(req.query.external_id || ''));
      pageUrl.searchParams.set('phone', String(req.query.phone || ''));
    }
    pageUrl.searchParams.set('pdf', '1');

    browser = await puppeteer.launch({
      headless: 'shell',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const appHost = req.get('host');
    const intentionallyBlockedRequests = new Set();

    page.on('console', (message) => {
      const type = message.type();
      const text = message.text();
      console.log(`[PDF page console:${type}] ${text}`);
    });

    page.on('pageerror', (error) => {
      console.error('[PDF page error]', error);
    });

    page.on('requestfailed', (request) => {
      if (intentionallyBlockedRequests.delete(request.url())) {
        return;
      }

      const failure = request.failure();
      console.error(
        `[PDF request failed] ${request.method()} ${request.url()}: ${failure?.errorText || 'Unknown error'}`
      );
    });

    page.on('response', (response) => {
      const responseUrl = new URL(response.url());
      if (response.status() >= 400 && responseUrl.pathname !== '/favicon.ico') {
        console.error(`[PDF HTTP ${response.status()}] ${response.url()}`);
      }
    });

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const isAppRequest = url.host === appHost;
      const canBlockExternal = ['document', 'script', 'stylesheet', 'font'].includes(request.resourceType());

      // Tailwind's browser CDN cannot be reached in the isolated PDF renderer.
      // The export stylesheet below supplies the styles the generated document needs.
      if (url.hostname === 'cdn.tailwindcss.com') {
        request.respond({
          status: 200,
          contentType: 'application/javascript',
          body: ''
        });
        return;
      }

      if (!isAppRequest && canBlockExternal) {
        intentionallyBlockedRequests.add(request.url());
        request.abort();
        return;
      }

      request.continue();
    });

    await page.setViewport({
      width: view === 'mobile' ? 430 : 1200,
      height: 900,
      deviceScaleFactor: 1
    });

    await page.goto(pageUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    try {
      await page.waitForFunction(() => {
        const messages = document.querySelector('#messages');
        if (!messages) return false;
        const text = messages.textContent || '';
        return !/Loading messages/i.test(text);
      }, { timeout: 60000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        url: window.location.href,
        readyState: document.readyState,
        messagesText: document.querySelector('#messages')?.textContent?.trim() || null,
        hasJQuery: typeof window.jQuery !== 'undefined',
        hasHelpers: typeof window.Helpers !== 'undefined',
        hasMessagesAPI: typeof window.MessagesAPI !== 'undefined',
        scripts: Array.from(document.scripts).map((script) => script.src || '[inline script]')
      })).catch((diagnosticError) => ({
        diagnosticError: diagnosticError.message
      }));

      console.error('[PDF page timeout diagnostics]', diagnostics);
      throw error;
    }

    await page.addStyleTag({
      content: `
        @font-face {
          font-family: "Telesaver Noto Emoji";
          src: url("/utils/NotoEmoji-Regular.ttf") format("truetype");
          font-style: normal;
          font-weight: 400;
          font-display: block;
        }

        html, body {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          background: #f8fafc !important;
        }

        body {
          display: block !important;
          width: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        #messages {
          display: block !important;
          width: 100% !important;
          max-width: none !important;
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          margin: 0 !important;
          padding: 8px !important;
          border: 0 !important;
          box-shadow: none !important;
        }

        .message {
          display: block !important;
          width: 280px !important;
          margin: 12px !important;
          padding: 24px !important;
          border: 0 !important;
          border-radius: 8px !important;
          background: #60a5fa !important;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .message > div {
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
        }

        .message .text {
          width: 100% !important;
          color: #1f2937 !important;
          font-family: Arial, "Segoe UI", "Telesaver Noto Emoji", sans-serif !important;
          white-space: pre-line !important;
          word-spacing: normal !important;
          letter-spacing: normal !important;
          overflow-wrap: anywhere !important;
        }

        .message .time {
          align-self: flex-end !important;
          color: #111827 !important;
          font-size: 0.75rem !important;
        }

        .message img,
        .message video {
          display: block !important;
          max-width: 100% !important;
          height: auto !important;
          margin-top: 12px !important;
          object-fit: contain !important;
        }

      `
    });

    await page.evaluate(async () => {
      const messages = document.querySelector('#messages');
      if (!messages) {
        throw new Error('The messages section was not found.');
      }

      messages.scrollTop = 0;
      document.body.replaceChildren(messages);

      const media = Array.from(messages.querySelectorAll('img, video'));
      const mediaReady = Promise.all(media.map((node) => new Promise((resolve) => {
        if (node.tagName === 'IMG') {
          if (node.complete) return resolve();
          node.addEventListener('load', resolve, { once: true });
          node.addEventListener('error', resolve, { once: true });
          return;
        }

        if (node.readyState >= 1) return resolve();
        node.addEventListener('loadedmetadata', resolve, { once: true });
        node.addEventListener('error', resolve, { once: true });
      })));

      await Promise.race([
        mediaReady,
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);

      await document.fonts.load('16px "Telesaver Noto Emoji"');
      await document.fonts.ready;
    });

    await page.emulateMediaType('screen');

    const pdfBytes = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.35in',
        right: '0.35in',
        bottom: '0.35in',
        left: '0.35in'
      }
    });
    const pdfBuffer = Buffer.from(pdfBytes);

    if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('The PDF renderer returned invalid document data.');
    }

    const filename = `${sanitizeFilenamePart(entityName, `${entityType}_${entityId}`)}_messages.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', getContentDisposition(filename));
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('Error exporting channel PDF:', err);
    res.status(500).json({
      error: 'Unable to export channel PDF.',
      details: err.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

module.exports = router;
