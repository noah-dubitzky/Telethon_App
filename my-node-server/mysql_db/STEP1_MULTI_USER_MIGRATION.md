# Step 1: Multi-user ownership migration

This step changes only the MySQL ownership model. It does not implement website
authentication, authorization middleware, Telegram browser login, Socket.IO
rooms, or multi-session workers. It also does not modify any Node.js route.

## Why the compatibility triggers exist

The current Node inserts do not provide `telegram_account_id`. Ownership must
still be non-null after this migration, so five temporary `BEFORE INSERT`
triggers assign the one account stored in `legacy_single_user_config`.

The value is database-controlled and cannot be selected by the browser.

These triggers are safe only for the existing single-account deployment. Do not
create or activate a second Telegram account until the later route-ownership
step removes the triggers and derives ownership from trusted server context.

## Before running

1. Confirm the target database is `messaging_personal`.
2. Record row counts for all six existing tables.
3. Create an RDS snapshot and wait for it to become `Available`.
4. Stop both PM2 processes so no writes occur during DDL/backfill.
5. Confirm the live tables still match the reviewed `SHOW CREATE TABLE` output.

Recommended pre-migration counts:

```sql
SELECT
  (SELECT COUNT(*) FROM senders) AS senders,
  (SELECT COUNT(*) FROM channels) AS channels,
  (SELECT COUNT(*) FROM messages) AS messages,
  (SELECT COUNT(*) FROM media) AS media,
  (SELECT COUNT(*) FROM sender_filters) AS sender_filters,
  (SELECT COUNT(*) FROM channel_filters) AS channel_filters;
```

## Run order

From a MySQL 8 client that can reach RDS:

```text
mysql --host=<rds-host> --user=<admin-user> --password messaging_personal \
  < mysql_db/migrations/001_multi_user_ownership.sql

mysql --host=<rds-host> --user=<admin-user> --password messaging_personal \
  < mysql_db/migrations/001_multi_user_ownership_verify.sql
```

Review every verification result before restarting the applications. Ownership,
orphan, and cross-account problem counts must all be zero. The five compatibility
triggers must all be listed. Row totals must match the pre-migration totals.

## Rollback

MySQL DDL implicitly commits, so `ROLLBACK` is not a reliable recovery mechanism
for this migration. If any migration statement or verification check fails:

1. Keep both applications stopped.
2. Save the MySQL error and verification output.
3. Restore the pre-migration RDS snapshot to a replacement database instance.
4. Verify the original row counts and application behavior on the restored DB.
5. Point the application at the restored instance only after verification.

Do not attempt an improvised down migration. Once multiple accounts contain the
same Telegram IDs, restoring the old global unique constraints could fail or mix
ownership.

## Transitional limitations

- Only one Telegram account may archive data while compatibility triggers exist.
- Existing rows retain `NULL` stable Telegram chat/message IDs because those
  values were never stored.
- Current routes remain globally readable until the authorization/ownership step.
- The unique message constraint becomes effective for new rows only after a later
  route change writes both Telegram identifiers.
- The legacy user has no email or password hash and cannot log in. Step 2 will
  establish real website credentials.

## Later cleanup boundary

After authorization middleware and account-aware routes are deployed, the later
step must:

1. Stop relying on `legacy_single_user_config`.
2. Drop all five `trg_*_legacy_owner_before_insert` triggers.
3. Drop `legacy_single_user_config`.
4. Require trusted account ownership in every insert and query.
5. Replace channel-name fallback matching with stable `telegram_chat_id` use.

That cleanup is intentionally not part of Step 1.
