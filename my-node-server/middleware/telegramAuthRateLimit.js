const buckets = new Map();

const POLICIES = {
  start: { limit: 3, windowMs: 15 * 60 * 1000 },
  code: { limit: 10, windowMs: 15 * 60 * 1000 },
  password: { limit: 5, windowMs: 15 * 60 * 1000 }
};

function telegramAuthRateLimit(action) {
  const policy = POLICIES[action];
  return (req, res, next) => {
    const now = Date.now();
    const key = `${action}:${req.auth.userId}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + policy.windowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > policy.limit) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many Telegram authentication attempts' });
    }
    return next();
  };
}

module.exports = telegramAuthRateLimit;
