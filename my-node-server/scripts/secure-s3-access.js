'use strict';
// Run without --apply to review the merged policy. Never used at server startup.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const { S3Client, GetBucketPolicyCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

function mergePolicy(policy, bucket, partition = 'aws') {
  const sid = 'TelesaverDenyPresignedReads';
  const statements = Array.isArray(policy.Statement) ? policy.Statement : policy.Statement ? [policy.Statement] : [];
  return { ...policy, Version: policy.Version || '2012-10-17', Statement: [
    ...statements.filter(statement => statement.Sid !== sid),
    { Sid: sid, Effect: 'Deny', Principal: '*', Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: `arn:${partition}:s3:::${bucket}/users/*`,
      Condition: { StringEquals: { 's3:authType': 'REST-QUERY-STRING' } } }
  ] };
}
async function main() {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket || !process.env.AWS_REGION) throw new Error('S3_BUCKET_NAME and AWS_REGION are required');
  const client = new S3Client({ region: process.env.AWS_REGION });
  let policy = { Version: '2012-10-17', Statement: [] };
  try {
    const result = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    policy = JSON.parse(result.Policy);
  } catch (error) { if (error.name !== 'NoSuchBucketPolicy') throw error; }
  const partition = process.env.AWS_REGION.startsWith('cn-') ? 'aws-cn'
    : process.env.AWS_REGION.startsWith('us-gov-') ? 'aws-us-gov' : 'aws';
  const merged = mergePolicy(policy, bucket, partition);
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify(merged, null, 2)); return; }
  const backup = `s3-policy-before-approval-${Date.now()}.json`;
  fs.writeFileSync(backup, JSON.stringify(policy, null, 2), { flag: 'wx', mode: 0o600 });
  await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(merged) }));
  console.log(`Presigned reads disabled under users/. Original policy saved to ${backup}.`);
}
if (require.main === module) main().catch(error => { console.error(error.name || 'Policy update failed'); process.exitCode = 1; });
module.exports = { mergePolicy };
