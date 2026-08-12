const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function encryptionConfig() {
  const encodedKey = process.env.TELEGRAM_SESSION_ENCRYPTION_KEY || '';
  const keyVersion = process.env.TELEGRAM_SESSION_KEY_VERSION || 'v1';
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    const error = new Error('Telegram session encryption is not configured');
    error.code = 'ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return { key, keyVersion };
}

function encryptSecret(value) {
  const { key, keyVersion } = encryptionConfig();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  }), 'utf8');
  return { ciphertext: payload, keyVersion };
}

function decryptSecret(ciphertext, storedKeyVersion) {
  const { key, keyVersion } = encryptionConfig();
  if (storedKeyVersion !== keyVersion) {
    const error = new Error('Stored Telegram session uses an unavailable key version');
    error.code = 'ENCRYPTION_KEY_VERSION_UNAVAILABLE';
    throw error;
  }
  const payload = JSON.parse(Buffer.from(ciphertext).toString('utf8'));
  if (payload.v !== 1) throw new Error('Unsupported encrypted-session format');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
