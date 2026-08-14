# Step 5 multi-session worker

Run exactly one ingestion worker (PM2 may keep its existing `main.py` command):

```text
python main.py
```

Required environment variables shared by Node and Python:

- `TELESAVER_WORKER_SECRET`: a random value of at least 32 characters.
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: server-side Telegram application credentials.
- `TELEGRAM_SESSION_ENCRYPTION_KEY`, `TELEGRAM_SESSION_KEY_VERSION`: Node-only Step 4 session decryption settings.

Optional worker settings:

- `NODE_INTERNAL_URL` (default `http://127.0.0.1:3000/internal/worker`)
- `NODE_API_URL` (default `http://127.0.0.1:3000`)
- `TELEGRAM_WORKER_HOST` / `TELEGRAM_WORKER_PORT` (defaults `127.0.0.1:8766`)
- `TELEGRAM_WORKER_URL` and `TELEGRAM_WORKER_TIMEOUT_MS` for Node callbacks
- `WORKER_HTTP_TIMEOUT_SECONDS`, `MEDIA_ROOT`, `ARCHIVE_TIMEZONE`, `LOG_LEVEL`

Install Python dependencies with `pip install -r requirements-step5.txt`. Start Node before the Python worker. On startup the worker asks Node for accounts whose encrypted session exists and whose status is `connected` or `starting`. Node decrypts sessions inside the trusted authenticated route; plaintext sessions never enter browser responses.

Step 4 calls the worker's authenticated localhost `start` operation after committing a session. Start is idempotent. The same control service supports `stop` and `restart`; these are internal operations and are not browser routes. If the callback is briefly unavailable, the saved account remains `connected` and is recovered on the next worker restart.

Media is now placed below `<MEDIA_ROOT>/<telegram_account_id>/images|videos`, avoiding cross-account filename collisions. Socket.IO broadcasting is intentionally not performed by this worker in Step 5.

## Legacy trigger retirement

The compatibility triggers and `legacy_single_user_config` are retained because the repository may still have legacy writers. The authenticated `/messages` worker path no longer relies on them. After production verification confirms every writer supplies ownership, review and execute manually:

```sql
DROP TRIGGER IF EXISTS trg_senders_legacy_owner_before_insert;
DROP TRIGGER IF EXISTS trg_channels_legacy_owner_before_insert;
DROP TRIGGER IF EXISTS trg_messages_legacy_owner_before_insert;
DROP TRIGGER IF EXISTS trg_sender_filters_legacy_owner_before_insert;
DROP TRIGGER IF EXISTS trg_channel_filters_legacy_owner_before_insert;
DROP TABLE legacy_single_user_config;
```

## Manual two-account verification

1. Configure two authorized Step 4 account rows and start Node plus one `python main.py` process.
2. Call authenticated `GET /health` on port 8766 and confirm both internal IDs appear once.
3. Send distinct messages visible to each Telegram account and verify `messages.telegram_account_id`, sender/channel ownership, Telegram message IDs, and media parent rows.
4. Create a deny filter for only one account and confirm the other account is unaffected.
5. Restart only the Python process and confirm both accounts restore without a verification code.
6. Complete a fresh Step 4 login and confirm its ID appears without restarting Python.
7. Call internal stop for one ID and confirm the other remains in health output and continues ingesting.
8. Test a revoked session and a stopped Node server; confirm the remaining clients stay connected and event failures are logged without secrets.

No schema migration is required for Step 5. Status values use the existing varchar field; `starting` and `revoked` are added operational values rather than a conflicting SQL enum.
