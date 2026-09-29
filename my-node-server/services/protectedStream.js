'use strict';
const { pipeline } = require('stream/promises');
const { isSessionValid, NOT_APPROVED } = require('./sessionValidity');
const transfers = new Map();

// The shared DB check also stops transfers served by another Node process.
// Revocation in this process aborts immediately; peers check once per second.
function watchTransfer(req, res, onCancel = () => {}) {
  const key = String(req.auth.userId);
  const controller = new AbortController();
  const snapshot = { userId: req.auth.userId, authVersion: req.session.authVersion };
  const active = transfers.get(key) || new Set();
  let checking = false;
  let stopped = false;
  const cancel = () => {
    controller.abort();
    Promise.resolve().then(onCancel).catch(() => {});
    res.destroy();
    cleanup();
  };
  active.add(cancel);
  transfers.set(key, active);
  const timer = setInterval(async () => {
    if (checking || stopped) return;
    checking = true;
    try { if (!await isSessionValid(snapshot)) cancel(); }
    catch (_) { cancel(); }
    finally { checking = false; }
  }, 1000);
  timer.unref();
  function cleanup() {
    stopped = true;
    clearInterval(timer);
    active.delete(cancel);
    if (!active.size) transfers.delete(key);
    res.off('close', cancel);
    res.off('finish', cleanup);
  }
  res.once('close', cancel);
  res.once('finish', cleanup);
  return { signal: controller.signal, cleanup };
}
function cancelUserTransfers(userId) {
  for (const cancel of [...(transfers.get(String(userId)) || [])]) cancel();
}

async function streamObject(req, res, media) {
  if (req.headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) {
    return res.status(416).end();
  }
  if (!await isSessionValid(req.session)) return res.status(403).json(NOT_APPROVED);
  const s3 = require('./s3Media');
  const guard = watchTransfer(req, res);
  try {
    const object = await s3.readObject(media, req.headers.range, guard.signal);
    if (guard.signal.aborted) { object.Body?.destroy(); return; }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "sandbox; default-src 'none'");
    const type = media.mime_type || 'application/octet-stream';
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/i.test(type);
    res.set('Content-Type', inline ? type : 'application/octet-stream');
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${s3.safeDownloadName(media.display_name || media.original_filename)}"`);
    res.set('Accept-Ranges', 'bytes');
    if (object.ContentRange) res.status(206).set('Content-Range', object.ContentRange);
    if (object.ContentLength != null) res.set('Content-Length', String(object.ContentLength));
    await pipeline(object.Body, res, { signal: guard.signal });
  } catch (error) {
    if (res.headersSent || guard.signal.aborted) { res.destroy(); return; }
    res.status(error.$metadata?.httpStatusCode === 416 ? 416 : error.name === 'NoSuchKey' ? 404 : 502)
      .json({ error: 'Unable to retrieve content' });
  } finally { guard.cleanup(); }
}
module.exports = { streamObject, watchTransfer, cancelUserTransfers };
