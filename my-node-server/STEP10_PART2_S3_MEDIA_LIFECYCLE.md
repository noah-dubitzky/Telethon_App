# Step 10 Part 2 — Private S3 Media Lifecycle

New S3 media remains private. All endpoints require a valid Telesaver website
session and resolve ownership through `media -> messages -> telegram_accounts -> user`.

## Database migration

Apply `mysql_db/migrations/006_s3_media_lifecycle.sql` after migration 005. It
adds `media.display_name`, a user-editable label separate from the immutable
Telegram `original_filename` and S3 object key.

## Endpoints

- `GET /api/media/:id/access` returns a five-minute presigned S3 URL. The
  duration can be set from 60–900 seconds with `S3_PRESIGN_SECONDS`. Legacy
  local records return their authenticated `/uploads/...` URL.
- `GET /api/media/:id/content` performs the same ownership check and redirects
  the browser to the short-lived URL. Message rendering uses this endpoint.
- `PATCH /api/media/:id` accepts `{ "display_name": "Quarterly report.pdf" }`.
  Use `null` to clear it. It never changes `s3_key` or `original_filename`.
- `DELETE /api/media/:id` deletes the S3 object (or legacy local file), then
  deletes the media metadata. The archived message itself remains intact.

Deletion locks the media record in a transaction. A storage failure rolls the
transaction back and keeps the metadata for a safe retry. If storage deletion
succeeds but the database commit fails, retrying is safe because S3 deletion is
idempotent; the diagnostic log includes `external_deleted=true`.

## Required IAM permissions

The Node server needs `s3:GetObject` and `s3:DeleteObject` for objects beneath
the Telesaver users prefix. The worker continues to need `s3:PutObject`.

## Tests

Run all local tests with `npm test`. The live MySQL migration/persistence test
remains available separately as `npm run test:s3-mysql`.
