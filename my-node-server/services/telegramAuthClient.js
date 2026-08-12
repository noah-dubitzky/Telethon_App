const SERVICE_URL = process.env.TELEGRAM_AUTH_SERVICE_URL || 'http://127.0.0.1:8765';

async function callTelegramAuth(action, payload) {
  const secret = process.env.TELEGRAM_AUTH_INTERNAL_SECRET;
  if (!secret) {
    const error = new Error('Telegram authentication service is not configured');
    error.code = 'SERVICE_NOT_CONFIGURED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${SERVICE_URL}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telesaver-internal-secret': secret
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('Telegram authentication request failed');
      error.code = body.error || 'TELEGRAM_SERVICE_ERROR';
      error.retryAfter = body.retry_after;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError' || error.cause?.code === 'ECONNREFUSED') {
      error.code = 'TELEGRAM_SERVICE_UNAVAILABLE';
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callTelegramAuth };
