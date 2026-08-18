# Step 8 Manage Telegram Account backend

Apply `mysql_db/migrations/003_account_filter_toggle.sql` before deploying the updated Node code, then run its verification file. The migration adds `telegram_accounts.filters_enabled BOOLEAN NOT NULL DEFAULT TRUE`; existing filtering therefore remains unchanged.

## Public authenticated contract

- `GET /api/telegram-accounts/:id/management` returns safe account fields, the enabled state, four live SQL counts, and the existing advanced-filter navigation link.
- `PATCH /api/telegram-accounts/:id/filters-enabled` accepts exactly `{ "enabled": true|false }`.

Both routes use the website session and query by `id AND user_id`. A missing account and another user's account both return 404. The browser never supplies `user_id`.

`filters_enabled=false` means all account sender/channel rules are bypassed and Telegram events are archived. Python already consumes Node's account-aware `allowed` result, so no Python change is required. The sender/channel rows remain intact and immediately apply again when the toggle is enabled.

## Manual verification

1. With separate sessions for users A and B, request each user's management endpoint and verify only owned accounts succeed.
2. Guess B's account while authenticated as A for both GET and PATCH; verify 404 and no state change.
3. Add allow/deny rows to both filter tables and verify all four counts directly reflect the tables.
4. Toggle false and true, reload management details, and verify persistence.
5. With false, send content matching a deny rule and verify the worker archives it; enable filtering and verify the rule applies again.
6. Exercise existing advanced filter list/create/update/delete operations with `telegram_account_id` and confirm account isolation.
7. Inspect responses and verify encrypted sessions, key versions, worker secrets, API credentials, and passwords are absent.

There are still no public disconnect, reconnect, pause, resume, delete, or re-authentication endpoints. Internal worker start/stop/restart controls are not browser APIs.
