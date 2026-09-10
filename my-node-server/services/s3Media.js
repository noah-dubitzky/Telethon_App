const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');

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

async function uploadPdfExport({ pdfBuffer, userId, accountId, filename }) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('A valid PDF buffer is required');
  }
  const { bucket } = configuration();
  const safeName = safeDownloadName(filename).replace(/\s+/g, '_');
  const storageKey = `users/${String(userId)}/telegram_accounts/${String(accountId)}/pdf_exports/${randomUUID()}/${safeName}`;
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    ContentDisposition: `attachment; filename="${safeName}"`
  }));
  return { storageKey, fileSize: pdfBuffer.length };
}

async function deletePdfExportObject({ storageKey, userId, accountId }) {
  assertOwnedKey(storageKey, userId, accountId);
  const { bucket } = configuration();
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
}

async function createPdfExportAccessUrl({ storageKey, userId, accountId, filename }, { expiresIn = 300 } = {}) {
  assertOwnedKey(storageKey, userId, accountId);
  const { bucket } = configuration();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentType: 'application/pdf',
    ResponseContentDisposition: `attachment; filename="${safeDownloadName(filename)}"`
  });
  return getSignedUrl(s3Client(), command, { expiresIn });
}

function resetClientForTests() {
  client = undefined;
}

async function storageTotals(userId, pdfKeys = new Set()) {
  if (!/^[1-9]\d*$/.test(String(userId))) throw new Error('Invalid storage owner');
  const { bucket } = configuration();
  const prefix = `users/${userId}/telegram_accounts/`;
  let token;
  let mediaBytes = 0;
  let pdfBytes = 0;
  do {
    const page = await s3Client().send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, ContinuationToken: token
    }));
    for (const object of page.Contents || []) {
      const key = object.Key || '';
      if (!key.startsWith(prefix) || key.endsWith('/')) continue;
      const bytes = Number(object.Size || 0);
      if (pdfKeys.has(key) || /\.pdf$/i.test(key) || key.slice(prefix.length).split('/')[1] === 'pdf_exports') pdfBytes += bytes;
      else mediaBytes += bytes;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && !token) throw new Error('Incomplete S3 listing');
  } while (token);
  return { mediaBytes, pdfBytes };
}

module.exports = {
  storageTotals,
  assertOwnedKey,
  createAccessUrl,
  deleteObject,
  uploadPdfExport,
  deletePdfExportObject,
  createPdfExportAccessUrl,
  safeDownloadName,
  resetClientForTests
};
