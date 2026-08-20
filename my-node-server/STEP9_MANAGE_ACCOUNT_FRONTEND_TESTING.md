# Step 9 Manage Telegram Account frontend

Manage URLs use `/manage-account.html?telegram_account_id=<internal-id>`. The page consumes the Step 8 management GET and filter-toggle PATCH endpoints. It never sends `user_id`; Node verifies ownership from the website session.

The account card archive link remains separate from its Manage link. Advanced Settings chooses the existing desktop/mobile filters page and retains the selector. That page now appends `telegram_account_id` to its list and sender/channel update requests, and its Back link returns to the same Manage page.

## Manual verification

1. Click the body of an account card and confirm its sender/channel archive opens.
2. Click Manage and confirm the matching management page opens instead.
3. Verify safe identity, status, dates, and all four backend counts.
4. Toggle filters off/on; verify the control disables while pending, persists after reload, and rolls back when Node is unavailable.
5. Open Advanced Settings, confirm only the selected account's entities appear, update both types, and return to the same Manage page.
6. Guess another user's ID and test missing/malformed IDs; confirm only the generic unavailable message appears.
7. Log out and directly open the Manage URL; confirm the login redirect.
8. Verify the layout on narrow mobile and desktop widths.

Reconnect, disconnect, pause, and removal buttons are visible but disabled because no safe public endpoints exist. Socket.IO behavior is unchanged.
