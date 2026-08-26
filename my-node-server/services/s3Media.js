const { DeleteObjectCommand, GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

function configuration() {
  const bucket = String(process.env.S3_BUCKET_NAME || '').trim();
  const region = String(process.env.AWS_REGION || '').trim();
  if (!bucket || !region) throw new Error('S3_BUCKET_NAME and AWS_REGION are required');
  return { bucket, region };
}

function s3Client() {
  const { region } = configuration();
  if (!client) client = new S3Client({ region });
  return client;
}

function assertOwnedKey(key, userId, accountId) {
  const expected = `users/${Number(userId)}/telegram_accounts/${Number(accountId)}/`;
  if (!String(key || '').startsWith(expected)) {
    const error = new Error('Stored media key does not match account ownership');
    error.code = 'INVALID_MEDIA_OWNERSHIP';
    throw error;
  }
}

function safeDownloadName(value) {
  return String(value || 'download')
    .replace(/[\r\n"\\/]+/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .slice(0, 180) || 'download';
}

async function createAccessUrl(media, { expiresIn = 300 } = {}) {
  assertOwnedKey(media.s3_key, media.user_id, media.telegram_account_id);
  const { bucket } = configuration();
  const disposition = /^(image|video|audio)\//i.test(media.mime_type || '') || media.mime_type === 'application/pdf'
    ? 'inline' : 'attachment';
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: media.s3_key,
    ResponseContentType: media.mime_type || undefined,
    ResponseContentDisposition: `${disposition}; filename="${safeDownloadName(media.display_name || media.original_filename)}"`
  });
  return getSignedUrl(s3Client(), command, { expiresIn });
}

async function deleteObject(media) {
  assertOwnedKey(media.s3_key, media.user_id, media.telegram_account_id);
  const { bucket } = configuration();
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: media.s3_key }));
}

function resetClientForTests() {
  client = undefined;
}

module.exports = { assertOwnedKey, createAccessUrl, deleteObject, safeDownloadName, resetClientForTests };
