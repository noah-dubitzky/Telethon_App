function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  req.auth = { userId: req.session.userId };
  return next();
}

module.exports = requireAuth;
