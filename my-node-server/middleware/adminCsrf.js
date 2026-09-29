'use strict';
const { timingSafeEqual } = require('crypto');
module.exports = function adminCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = Buffer.from(req.get('x-csrf-token') || '');
  const expected = Buffer.from(req.session?.csrfToken || '');
  if (req.get('sec-fetch-site') === 'cross-site' || !expected.length
      || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(403).json({ error: 'Invalid administrator CSRF token' });
  }
  next();
};
