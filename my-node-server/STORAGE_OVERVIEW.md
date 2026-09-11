# Storage overview

The authenticated `/api/storage` endpoint returns message text bytes and current S3 object sizes for the signed-in user. It uses the existing database and AWS configuration; no migration is required.

The server AWS role needs `s3:ListBucket` on the configured bucket, permitting the `users/*/telegram_accounts/` prefixes. Existing object read/write permissions alone do not grant listing access. The endpoint supplies the authenticated user's exact prefix and follows all continuation pages. It never downloads objects or checks legacy local files.

Text is the sum of `OCTET_LENGTH(messages.text)` across the user's Telegram accounts. PDF attachments are identified by their database MIME type or `.pdf` extension; the `pdf_exports` object folder is also counted as PDFs. Other objects under the user's Telegram account prefix count as media, including objects without database records. Directory markers are ignored. The total excludes database overhead, backups and noncurrent S3 object versions.

Successful results are cached per user for 60 seconds. Refresh bypasses completed cached results; concurrent calculations for one user share a request. Failed listings return an error rather than partial totals.

Run `npm run test:storage` for mocked pagination, classification, ownership, caching and failure checks. Run `node test/settings.browser.cjs` for mocked browser checks. These do not verify live bucket permissions or data.

## Automatic saving preferences

Before deploying these controls, apply `mysql_db/migrations/011_storage_settings.sql` to the application's MySQL database, then restart both the Node server and Telegram worker. The migration adds a per-user preferences table; existing users default to all content types enabled with no size limit. No existing content is deleted or modified.

The authenticated `GET /api/storage/settings` and `PUT /api/storage/settings` endpoints load and replace the signed-in user's preferences. All six boolean fields and `max_file_size_mb` are required when saving. The size is null (unlimited) or an integer from 1 to 100,000 decimal MB.

The worker obtains current preferences through its authenticated account-specific endpoint before each new event is saved. Preferences apply across linked Telegram accounts, and an event already in progress uses the preferences it read. If preferences cannot be read, the event is not archived; the worker logs the failure rather than defaulting to unrestricted saving. There is no automatic replay of such failed events.

Text includes captions. Photos cover images; audio covers voice messages. Stickers belong to Other files. PDFs are classified independently by MIME type or extension. Disabling text leaves media messages with null text; events with no enabled text or successfully stored media are skipped. Manual PDF exports are unaffected.

Oversized media is skipped before download when size metadata is available. Download progress and actual temporary-file size provide additional checks before S3 upload. Temporary files are cleaned up when a limit is exceeded. Existing automatic-save account/filter controls still apply.

Run `python -m unittest test_worker` from the repository root to verify worker enforcement, in addition to the storage and browser checks above.

## Retention

Apply `mysql_db/migrations/012_storage_retention.sql` once after migration 011 and restart Node. This adds three nullable day counts (null means Forever), plus saved timestamps for message text and media. Existing text and media receive the migration-time timestamp; exports use their existing reliable `created_at`. New inserts receive timestamps automatically, and duplicate ingestion does not extend the original retention clock. All retention defaults are Forever.

The separate retention form supports Forever, 30 days, 90 days, 365 days, or custom integer periods from 1 to 36,500 days. `POST /api/retention/preview` counts nonempty message bodies, S3-backed non-PDF media, and PDF attachments plus exports under the proposed periods. Text counts represent message bodies/captions, not physical text files. Missing old local media is excluded. Counts use database records; an already-missing S3 object can still have a record awaiting cleanup.

Shortening requires confirmation even when counts are zero. The confirmation token is bound to the signed-in user, session, original settings, and proposed settings, and expires after five minutes. Changing settings in another session invalidates a stale confirmation. Counts are a point-in-time preview of currently eligible content under all three proposed periods, not a permanent deletion manifest; more content may age into eligibility later.

Cleanup starts on Node startup and runs hourly in the background with a database advisory lock to avoid overlapping application instances. Each pass processes up to 100 message bodies, 100 media files, 100 PDF attachments, and 100 exports per user. Larger backlogs take multiple passes. The task locks the user's preference row while processing each batch, so saves wait for the active batch to finish. It emits no socket events, frontend updates, or cleanup progress UI.

Text cleanup sets only `messages.text` to NULL, preserving message identity and references. File cleanup deletes S3 content before its database row. Failures remain eligible for retry on later passes; a database failure after S3 deletion is safe to retry. No local files are searched or deleted. The existing S3 deletion permissions are required. Database free space and noncurrent object versions in versioned S3 buckets may remain after logical deletion.

Run `npm run test:retention` for mocked backend tests and `node test/settings.browser.cjs` for the browser preview/cancel/confirm flow. These do not apply the migration or delete live data.
