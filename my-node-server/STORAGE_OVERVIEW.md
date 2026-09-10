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
