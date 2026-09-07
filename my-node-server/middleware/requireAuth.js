const { isSessionValid } = require('../services/sessionValidity');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!await isSessionValid(req.session)) {
      return req.session.destroy(() => res.status(401).json({ error: 'Authentication required' }));
    }
    req.auth = { userId: req.session.userId };
    return next();
  } catch (_) {
    return res.status(503).json({ error: 'Unable to verify your session. Please try again.' });
  }
}

module.exports = requireAuth;
