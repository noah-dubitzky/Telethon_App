const crypto = require('crypto');

module.exports = function requireWorker(req, res, next) {
  const expected = process.env.TELESAVER_WORKER_SECRET || '';
  const supplied = req.get('x-telesaver-worker-secret') || '';
  if (expected.length < 32 || supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Unauthorized worker request' });
  }
  next();
};
