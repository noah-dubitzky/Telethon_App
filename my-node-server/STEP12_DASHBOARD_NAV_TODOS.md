# Step 12 dashboard navigation TODOs

The desktop dashboard sidebar now reserves internal routes for the main TeleSaver workflows. Routes marked **Soon** are placeholders until their pages and APIs are implemented.

## All Messages — `/desktop/all-messages.html` (implemented)

- Displays the received-message feed across all user-owned Telegram accounts.
- Loads 50 messages initially and 15 additional messages at the scroll boundary.
- Preserves links into the existing sender and channel conversation pages.
- Future enhancement: account, date, sender/channel, media, and keyword filters.

## People — `/desktop/people.html`

- Create an ownership-scoped sender directory across all connected accounts.
- Keep identical Telegram users separated by their observed TeleSaver account identity.
- Show account name, observed sender name, phone when available, message count, and latest-message time.
- Add search and account filtering.

## Channels — `/desktop/archive-channels.html`

- Create an ownership-scoped channel directory across all accounts.
- Show account name, channel name, message count, latest-message time, and recent preview.
- Add search and account filtering.
- Link each result to the existing channel conversation page with `telegram_account_id`.

## Media & Files — `/desktop/media-library.html`

- Create an authenticated cross-account media library.
- Support photos, videos, documents, audio, and other archived attachments.
- Add account, conversation, date, and media-type filters.
- Use the authenticated media-content route for previews and downloads.
- Preserve S3 ownership checks and legacy-media compatibility.

## Existing destinations

- Dashboard: `/desktop/index.html`
- Accounts & Settings: `/settings.html` (existing settings page; sidebar destination marked Soon pending the consolidated account/settings experience)
