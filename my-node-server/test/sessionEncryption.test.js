const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');

test('Telegram secrets round-trip through authenticated encryption', () => {
  process.env.TELEGRAM_SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.TELEGRAM_SESSION_KEY_VERSION = 'test-v1';
  const { encryptSecret, decryptSecret } = require('../security/sessionEncryption');
  const encrypted = encryptSecret('private-session-value');
  assert.equal(encrypted.keyVersion, 'test-v1');
  assert.doesNotMatch(encrypted.ciphertext.toString('utf8'), /private-session-value/);
  assert.equal(decryptSecret(encrypted.ciphertext, encrypted.keyVersion), 'private-session-value');
});

test('tampered ciphertext is rejected', () => {
  process.env.TELEGRAM_SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.TELEGRAM_SESSION_KEY_VERSION = 'test-v2';
  const { encryptSecret, decryptSecret } = require('../security/sessionEncryption');
  const encrypted = encryptSecret('private-session-value');
  const payload = JSON.parse(encrypted.ciphertext.toString('utf8'));
  payload.data = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptSecret(Buffer.from(JSON.stringify(payload)), encrypted.keyVersion));
});
