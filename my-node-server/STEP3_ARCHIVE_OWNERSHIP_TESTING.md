# Step 3 archive ownership test plan

Automated integration tests are not configured in this repository, and this checkout has no database credentials. Run this plan against a disposable MySQL database after applying migration 001.

## Fixture

Create two active website users (A and B), one Telegram account for each, and distinct sender, channel, message, media, sender-filter, and channel-filter rows for each account. Give both accounts one sender with the same `external_sender_id`; this proves external Telegram IDs are not treated as globally owned. Put two real test files beneath `public/uploads` and store their paths in the matching media rows.

Start Node with a test `SESSION_SECRET`, log both users in through `POST /api/auth/login`, and save their cookie jars as `a.cookies` and `b.cookies`. Record all fixture IDs as shell variables.

## Required checks

For every authenticated request below, repeat it without a cookie and expect HTTP 401.

1. With A's cookie, `GET /messages`, `/messages/senders`, `/messages/channels`, and `/messages/entities` return only A rows. Repeat with B's cookie and expect only B rows.
2. With A's cookie, `GET /messages/sender/{A sender id}` and `/messages/channel/{A channel id}` return A messages. Substitute B's internal IDs and expect an empty array.
3. With A's cookie, `GET /messages/senders/{shared external sender id}?telegram_account_id={A account id}` returns A's sender. Substitute B's account ID and expect 404. Query an external ID present only for B and expect 404.
4. Add `telegram_account_id={B account id}` to each A request and expect 404. Put the same foreign selector in filter request bodies and expect 404.
5. With A's cookie, request A's `/uploads/...` file and expect 200. Request B's path and expect 404. Without a cookie expect 401.
6. With A's cookie, `GET /api/filters` and `GET /filters/list` contain only A filters/entities.
7. With A's cookie, toggle A sender/channel filters and expect 200. Substitute B's sender/channel IDs and expect 404; verify B's database rows did not change.
8. With A's cookie, call `/filters/update` and `/filters/delete` using B filter IDs and expect 404. Call `/filters/create` with B's account ID and expect 404. With A's account ID, expect success.
9. With A's cookie, export A sender and channel IDs through `GET /export/channel-pdf?id=...&type=...`; expect a PDF. Substitute B IDs and expect 404. Without a cookie expect 401.
10. If a user owns multiple Telegram accounts, omit the selector on read routes and verify the union of only that user's accounts. Filter creation without a selector must return 400; creation with either owned selector must succeed.
11. POST a legacy worker-shaped payload to `/filters/check`, then to `/messages`. Verify it still uses the server-controlled `legacy_single_user_config` account and inserts successfully without a website session.
12. Re-run the migrated owner's existing dashboard flows: latest messages, sender/channel pages, filter toggles, media display, pagination, and PDF export.

## Known worker boundary

`POST /messages`, `POST /filters/check`, and `POST /receive` remain legacy worker endpoints without worker credentials. They must not be exposed publicly. The Python worker does not yet send a trusted Telegram-account ID, so the compatibility triggers and `legacy_single_user_config` cannot be removed in Step 3. Add worker authentication and an explicit trusted account context before enabling multiple workers/accounts.
