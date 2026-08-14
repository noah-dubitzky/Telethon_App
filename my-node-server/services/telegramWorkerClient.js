const http = require('http');

function controlAccount(action, accountId) {
  const secret = process.env.TELESAVER_WORKER_SECRET || '';
  if (secret.length < 32) return Promise.reject(Object.assign(new Error('Worker is not configured'), { code: 'WORKER_NOT_CONFIGURED' }));
  const base = new URL(process.env.TELEGRAM_WORKER_URL || 'http://127.0.0.1:8766');
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: base.hostname, port: base.port, method: 'POST',
      path: `/accounts/${accountId}/${action}`,
      headers: { 'x-telesaver-worker-secret': secret, 'content-length': 0 },
      timeout: Number(process.env.TELEGRAM_WORKER_TIMEOUT_MS || 5000)
    }, response => {
      response.resume();
      response.on('end', () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve() : reject(Object.assign(new Error('Worker rejected request'), { code: 'WORKER_REJECTED' })));
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Worker timed out'), { code: 'WORKER_TIMEOUT' })));
    request.on('error', reject);
    request.end();
  });
}

module.exports = { controlAccount };
