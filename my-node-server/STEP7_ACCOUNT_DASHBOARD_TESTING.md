# Step 7 account dashboard testing

The desktop and mobile `index.html` pages now have two modes. Without a query selector they list the authenticated user's Telegram accounts. With `?telegram_account_id=<internal-id>` they show only that account's senders and channels. The server validates ownership for both the account lookup and entity query.

Cards use the safe API fields `display_name`, `telegram_user_id`, `connection_status`, `connected_at`, and `last_seen_at`. The disabled **Manage — Coming soon** button performs no account action.

## Manual verification

1. Confirm a logged-out direct visit to either dashboard redirects to `/`.
2. With two browser profiles, confirm each Telesaver user sees only their own account cards.
3. Open an account and confirm the URL contains only `telegram_account_id`, never `user_id`.
4. Replace that selector with another user's account ID and confirm a friendly not-found error.
5. Confirm each account has separate Senders and Channels lists and correct empty states.
6. Open sender and channel messages; confirm their URLs and HTTP requests retain `telegram_account_id`.
7. Use Back to account, then Back to Telegram Accounts, and verify context is preserved appropriately.
8. Switch repeatedly between two accounts and confirm entities/messages never mix.
9. Confirm PDF export includes the account selector and remains ownership checked.
10. Confirm Manage is disabled and performs no action; connect/reconnect/disconnect remain deferred.

Socket.IO still uses the existing global transport. The UI now ignores live events whose `telegram_account_id` differs from the selected account, but private authenticated rooms remain a later step.
