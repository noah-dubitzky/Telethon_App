'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('node:assert/strict');
const { HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { createAccessUrl, deleteObject } = require('../services/s3Media');

async function run() {
  const bucket = process.env.S3_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  assert.ok(bucket && region, 'S3_BUCKET_NAME and AWS_REGION are required');
  const client = new S3Client({ region });
  const media = {
    user_id: 0,
    telegram_account_id: 0,
    s3_key: `users/0/telegram_accounts/0/other/part2_${Date.now()}.txt`,
    original_filename: 'part2-test.txt',
    display_name: 'Part 2 test.txt',
    mime_type: 'text/plain'
  };
  const body = 'Telesaver Step 10 Part 2 lifecycle test';
  let uploaded = false;

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: media.s3_key, Body: body, ContentType: media.mime_type
    }));
    uploaded = true;
    const url = await createAccessUrl(media, { expiresIn: 60 });
    assert.ok(!url.includes(process.env.AWS_SECRET_ACCESS_KEY || 'never-match'), 'URL must not expose the AWS secret');
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), body);

    await deleteObject(media);
    uploaded = false;
    await assert.rejects(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: media.s3_key })),
      error => [403, 404].includes(error?.$metadata?.httpStatusCode)
    );
    console.log('Live Node S3 presign, retrieval, deletion, and absence verification passed');
  } finally {
    if (uploaded) await deleteObject(media).catch(() => {});
  }
}

run().catch(error => {
  console.error(`Live Node S3 lifecycle test failed: ${error.message}`);
  process.exitCode = 1;
});
