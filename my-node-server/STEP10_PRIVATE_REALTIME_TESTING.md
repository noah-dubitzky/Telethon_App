# Step 10 private real-time testing

Socket.IO reuses the `telesaver.sid` Express session during every handshake. An
authenticated socket joins the server-derived `user:<id>` room. The browser
never supplies a room or user ID. Before each live delivery, Node reloads every
target socket's session from the authoritative session store; missing, expired,
or changed sessions are disconnected. Logout destroys the HTTP session and
disconnects all sockets associated with that session. Reconnection performs the
full handshake and room assignment again.

The worker continues to send only its authenticated HTTP ingestion request.
`POST /messages` commits the archive transaction, resolves
`telegram_accounts.user_id`, then emits `updateMessage` to that user's sockets.
Socket lookup or delivery failures are caught after the commit.

## Automated check

Run `npm test`. The Step 10 checks verify that the global broadcast and legacy
`/receive` endpoint are absent, session-derived rooms are configured, ownership
is queried after persistence, logout disconnects the session, and all active
live views filter by Telegram account context.

## Two-user integration check

1. Sign in as User A and User B in isolated browser profiles and connect a
   Socket.IO client in each. Open two tabs for A.
2. In browser developer tools, confirm an anonymous profile receives a Socket.IO
   `connect_error`, while each authenticated profile connects normally.
3. Ingest a worker-authenticated message for an account owned by A. Confirm the
   row exists in MySQL, both A tabs update, and B does not update.
4. Repeat with B's account. Then view one of A's other Telegram accounts and
   confirm the event does not alter that visible archive.
5. Change query-string account IDs or attempt `socket.emit('join', 'user:...')`.
   Confirm this does not change room membership.
6. Log A out. Confirm A's existing sockets disconnect and a reconnect attempt is
   rejected. Let another session expire and confirm its socket is disconnected
   on the next attempted private delivery.
7. Close all browsers and ingest another message. Confirm it remains archived.

The implementation intentionally does not queue Socket.IO events for offline
browsers; normal archive APIs provide missed messages after reconnection.
