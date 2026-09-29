# Administrator approval and suspension

## Behavior

Registration creates a normal `users` row with `is_approved = FALSE`, hashes the
password using the existing bcrypt implementation, and creates no authenticated
session. Correct credentials for an unapproved user return HTTP 403 with
`ACCOUNT_NOT_APPROVED`; wrong credentials return HTTP 401.

`/admin` is a separate, unlinked administrator page. Administrators use their own
`admins` table, cookie (`telesaver.admin.sid`), and production MySQL session table
(`admin_sessions`). Normal user approval never confers administrator rights.
Passwords are hashed with bcrypt cost 12. Admin changes, including login and logout,
require a session-bound CSRF token. Database-backed login limits apply per username
and source IP. Admin sessions expire after four hours; password reset invalidates
old admin sessions through their own `auth_version`.

Suspending a previously approved user atomically sets approval false and increments
`users.auth_version`. Repeating an already completed suspension does not increment it
again, but retries worker-stop notifications. The next authenticated request returns
403 and destroys that session; later requests without a session return 401. Unused
old cookies remain invalid after reapproval. Database failure denies access with 503.

All saved Telegram credentials and archive settings remain intact. Each account is
sent an immediate worker `pause` command, which disconnects its Telethon client and
cancels event processing. The worker independently rechecks owner approval and
`auth_version` every two seconds, plus backend request latency (the existing default
HTTP timeout is ten seconds). Failure to verify eligibility disconnects all active
clients. A failed stop notification is returned as `worker_pause_pending: true`, not
reported as a confirmed stop. Database authorization blocks worker access and
ingestion regardless of that notification. Ingestion locks the owner until commit,
so it cannot commit after a completed suspension using an old generation.

Reapproval permits a fresh website login. Users explicitly reconnect their Telegram
accounts from account management; archiving preferences are not reset. A password
or email change also advances the existing auth version, so connected Telegram
clients require reconnecting after those security changes.

Cancellation cannot undo work already completed. An S3 upload already executing in
the boto3 transfer thread may finish while the worker drains that operation; its
message is not ingested after revocation. This can leave an unreferenced private S3
object. Previously saved data is never deleted by suspension. Existing configured
retention policies continue independently.

Media and saved PDF content now stream through authenticated application routes,
with ownership checks, no-store caching and byte-range support. They never redirect
the browser to S3. Suspension cancels local active streams immediately; other Node
processes recheck authorization once per second. Running PDF generation is also
cancelled and rechecks authorization before persistence. Bytes already received or
files previously downloaded cannot be recalled.

## Database inspection and migration

Read-only inspection of the configured database during development found one active
login-capable user, `auth_version`, and a legacy `uk_users_singleton` unique index on
a generated constant `singleton_guard` column. That index blocks a second registration.
Migration 013 removes only that obsolete index if present and retains the column and
the unique email index. No migration was run during implementation.

Use a verified database snapshot. Stop Node and the Python worker during cutover;
do not allow registrations between the column addition and the backfill.
Inspect the target database again before applying:

```sql
SHOW COLUMNS FROM users;
SHOW INDEX FROM users;
SELECT id, email, status, auth_version,
       (email IS NOT NULL AND password_hash IS NOT NULL) AS login_capable
FROM users ORDER BY id;
```

The explicit backfill policy approves **all existing active accounts that have both
email and password hash**. Review those rows first. If some should not receive access,
replace the backfill predicate with the reviewed IDs before executing the migration.
Placeholder and inactive accounts stay unapproved; the default for future rows stays
false. Administrator approval does not override the existing `status` check.

After migrations 001–012, select the intended database in MySQL Workbench and run
`mysql_db/migrations/013_admin_approval.sql` once, then
`mysql_db/migrations/013_admin_approval_verify.sql`. These files intentionally do not
hard-code a database name. MySQL DDL implicitly commits; rollback is not a safe way
to undo a partially applied migration. Inspect a partial application before retrying.

New schema: `users.is_approved`; `admins` (ID, username, password hash, auth version,
created timestamp); `admin_sessions`; `admin_login_limits`. No approval-request table.

## Initial administrator

From `my-node-server`, with the existing database environment configured:

```text
node scripts/create-admin.js your-admin-name
```

The command prompts twice without echoing the password. Use at least 12 characters
and no more than 72 UTF-8 bytes. Passwords are never accepted as command-line arguments.
There is no default password or public administrator registration.

Reset an existing administrator, invalidating their old sessions:

```text
node scripts/create-admin.js your-admin-name --reset
```

Production uses the existing HTTPS/trusted-proxy settings and secure, HttpOnly,
SameSite=Strict admin cookies. Optionally set a separate `ADMIN_SESSION_SECRET` of at
least 32 characters; otherwise the existing `SESSION_SECRET` is used. The cookie,
session store, and administrator identity remain separate in either case. Local
development uses a memory session store, as the existing user authentication does.

## Required S3 cutover

**The code change alone cannot invalidate old direct S3 presigned URLs.** Before
reopening the application, apply the provided bucket-policy cutover. It denies all
query-string-signed GetObject/GetObjectVersion reads under this bucket's `users/`
prefix. This retires old direct URLs for every Telesaver user, while the server's
header-authenticated SDK reads continue. It also affects any other consumer using
presigned reads under the same prefix; review the merged policy first.

From `my-node-server`, using deployment credentials with `s3:GetBucketPolicy` and
`s3:PutBucketPolicy`, and the existing `S3_BUCKET_NAME` / `AWS_REGION`:

```text
node scripts/secure-s3-access.js
node scripts/secure-s3-access.js --apply
```

The first command prints the merged policy without changing AWS. The second backs
up the original policy locally and applies the merged policy; unrelated statements
are preserved. Serialize this operation with other bucket-policy changes. The web
server does not require bucket-policy write permissions. Retain the existing private
bucket/block-public-access configuration. No policy was applied during implementation.

AWS documents `s3:authType = REST-QUERY-STRING` for this purpose:
https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/additional-guardrails.html

Verify an old, still-unexpired direct URL now returns 403 and an approved user's
application content URL still works. Do not use direct presigned URLs as a rollback
path: removing the deny can revive unexpired old links. Restart Node and the updated
Python worker together after database and S3 cutover; older worker payloads omit the
required auth version and are intentionally rejected by ingestion.

## Routes and authorization

Public admin bootstrap: `GET /api/admin/csrf`, `POST /api/admin/login` (CSRF and login
rate limits apply). Administrator-only: `GET /api/admin/me`, `POST /api/admin/logout`,
`GET /api/admin/users?page=0`, `PATCH /api/admin/users/:id/approval` with a strict
boolean `isApproved`. The listing returns only ID, email, approval, and creation date,
100 at a time, with `has_more`. The page can navigate through every user.

Existing authenticated routes now share current approval validation: `/api/auth/me`,
profile, Telegram account management/connect, filters, messages, media, `/uploads`,
storage, retention, PDF exports and `/export`. Registration/login/logout stay usable
without an approved user session. Socket.IO handshake and private sends share the
same validity service.

Worker authentication remains service-specific. New `GET /internal/worker/eligibility`
returns eligible account IDs and auth versions. Existing account lookup, settings,
filter and status operations also check the owner's approval. Disconnected status
acknowledgments remain allowed so suspension can finish. The local Python control
server adds `POST /accounts/:id/pause`.

## Verification

```text
# From my-node-server
npm test
npm run test:approval
npm run test:admin-ui
# From the repository root
python -m unittest test_worker test_worker_approval
```

HTTP tests use real Express/session middleware with mocked database and worker/S3
boundaries. They cover registration injection, no automatic session, wrong-password
versus pending responses, admin CSRF and privilege separation, multiple cookies,
revoke/reapprove, auth-version increment, DB failure, worker notification failure,
worker API/ingestion denial, old media links, range delivery and active stream aborts.
Python tests cover owner-wide disconnection, other-user isolation, cancellation,
fast reapproval with stale worker versions and backend failures.
The browser test uses the installed Puppeteer/Chrome with mocked admin API responses
to exercise login, safe text rendering, approval, revocation and logout. It does not
access the live database or AWS.

After deployment, register a fresh user, verify pending login, approve from `/admin`,
log in on two browsers, connect multiple Telegram accounts, begin a media download,
and revoke without logging out. Confirm both browser APIs are denied, workers stop,
download stops, ingestion is denied, and saved data remains. Reapprove and confirm
old cookies cannot be reused; log in again and reconnect accounts explicitly. Test
admin APIs using a normal user's cookie and verify denial. Test the old direct S3
URL as described above. AWS/Telegram end-to-end behavior requires this staging or
deployment check; the automated tests do not mutate those external services.

## File map

Created: migration 013 and verification SQL; `middleware/adminSession.js`,
`adminCsrf.js`, `adminRateLimit.js`, `requireAdmin.js`; `routes/admin.js`;
`services/accountApproval.js`, `protectedStream.js`, `workerEligibility.js`;
`scripts/create-admin.js`, `secure-s3-access.js`; `public/admin/index.html`,
`public/scripts/admin.js`; approval/media/worker HTTP tests, admin browser test and their fixture loader;
root `test_worker_approval.py`; this guide.

Modified: server mounting; shared auth/session/realtime validation; registration and
login routes/UI; page session guard; media/local media/PDF content and PDF generation;
Telegram connection finalization; worker routes and message ingestion; S3 reading
service; Python worker/control client; affected existing tests; package scripts and
policy-backup ignore rule. Approval is enforced through existing `requireAuth` and
`sessionValidity` rather than a second per-route database query.
