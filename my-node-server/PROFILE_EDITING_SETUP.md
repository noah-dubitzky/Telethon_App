# Profile editing

Apply `mysql_db/migrations/010_profile_editing.sql` to the application database
once, before restarting the Node server with this version. It adds a display name,
a session revocation version, pending email verification, and persistent rate limits.
It does not change existing email addresses or passwords. Existing website sessions
start at version zero and remain valid until a password or email change.

Configure these server environment variables for email changes:

```
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=TeleSaver <verified-sender@your-domain.example>
```

Use port 587 for required STARTTLS or 465 for immediate TLS. Certificates are
verified. Use a sender approved by your email provider. Credentials belong in
the server environment, never in browser code or source control. See the
[Nodemailer SMTP documentation](https://nodemailer.com/smtp) for provider options.
Without SMTP configuration, name and password editing work and email changes
are unavailable. No real verification messages are sent by the automated tests.

Email changes require the current password and an eight-digit code sent to the
new address. Codes expire in 15 minutes, permit five incorrect attempts, and are
stored only as hashes. Requesting another code replaces the previous code.
The pending change survives page reloads and can be cancelled. A verified change
notifies the previous address; if that notification fails, the UI reports it.

Email/password changes increment the account's session version. HTTP requests
and realtime delivery reject older versions, and existing other sockets are
disconnected. The initiating browser receives a refreshed session. If that refresh
fails after the change commits, the user is asked to sign in with the new credentials.
Password changes also cancel pending email changes.

Validation:

```
npm test
node test/profileEditing.test.cjs
node test/settings.browser.cjs
```

The profile endpoint tests use an isolated database fixture, actual Express sessions,
and bcrypt. Browser tests mock APIs and CSS; they do not verify SMTP or production
database connectivity. After deployment, verify a name edit, a password change with
two browsers, and an email change using a mailbox you control.
