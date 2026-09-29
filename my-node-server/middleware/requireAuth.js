const { sessionState, NOT_APPROVED } = require('../services/sessionValidity');

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const state = await sessionState(req.session);
    if (state !== 'approved') {
      return req.session.destroy(() => {
        if (req.app.locals.sessionCookieName) res.clearCookie(req.app.locals.sessionCookieName, req.app.locals.sessionCookieClearOptions);
        return res.status(state === 'unapproved' ? 403 : 401).json(
          state === 'unapproved' ? NOT_APPROVED : { error: 'Authentication required' });
      });
    }
    req.auth = { userId: req.session.userId };
    return next();
  } catch (_) {
    return res.status(503).json({ error: 'Unable to verify your session. Please try again.' });
  }
}

module.exports = requireAuth;
