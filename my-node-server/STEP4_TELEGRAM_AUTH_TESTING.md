# Step 4 browser Telegram authentication

## Configuration

Apply `mysql_db/migrations/002_telegram_browser_auth.sql` after checking that no non-NULL `telegram_user_id` is already assigned to multiple website users.

Generate independent secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The base64 value is `TELEGRAM_SESSION_ENCRYPTION_KEY`. The hex value is `TELEGRAM_AUTH_INTERNAL_SECRET`. Put the shared internal secret and the existing application Telegram API ID/hash into the environment of `telegram_auth_service.py`. Put the internal secret, encryption key, key version, and service URL into Node's `.env`.

Start the internal service from the repository root, with its environment already set:

```powershell
python telegram_auth_service.py
```

Start Node separately:

```powershell
Set-Location my-node-server
node server.js
```

## Browser API sequence

Log in and retain the website session, then start a connection:

```powershell
$baseUrl = 'http://localhost:3000'
$login = @{ email='person@example.com'; password='a-long-test-password' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" -ContentType application/json -Body $login -SessionVariable web

$start = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/telegram-connect/start" `
  -WebSession $web -ContentType application/json `
  -Body (@{ phone_number='+15551234567' } | ConvertTo-Json)
$start
```

Enter the code received from Telegram immediately. The code exists only in this request:

```powershell
$result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/telegram-connect/verify-code" `
  -WebSession $web -ContentType application/json `
  -Body (@{ attempt_id=$start.attempt_id; code='12345' } | ConvertTo-Json)
$result
```

If `status` is `password_required`, submit the Telegram two-step password. It is forwarded once and is never persisted:

```powershell
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/telegram-connect/verify-password" `
  -WebSession $web -ContentType application/json `
  -Body (@{ attempt_id=$start.attempt_id; password='telegram-password' } | ConvertTo-Json)
```

Check public-safe state:

```powershell
Invoke-RestMethod -Uri "$baseUrl/api/telegram-connect/attempts/$($start.attempt_id)" -WebSession $web
Invoke-RestMethod -Uri "$baseUrl/api/telegram-accounts" -WebSession $web
```

A completed attempt is deleted, so its attempt-status route returns 404. The account list should show `connected` but must never contain `session_ciphertext`, `session_key_version`, or temporary state.

## Required security checks

- Repeat every route without `-WebSession`; expect 401.
- Use a second website user's session with the first user's attempt ID; expect 404.
- Wait more than ten minutes or set `expires_at` into the past; expect 410 and deletion.
- Submit an incorrect code/password; expect a sanitized 400 response.
- A fourth code-send request inside fifteen minutes should return 429.
- Reconnect the same Telegram identity as the same user; the existing account row should update.
- Attempt the same Telegram identity as another user; expect 409 with no ownership change.
- Confirm `session_ciphertext` is not readable as a Telethon StringSession and that no API response includes it.
- Restart Node and verify the connected account row is unchanged.
- Start a one-off Telethon client from the decrypted saved StringSession in a trusted maintenance script and verify `is_user_authorized()`; do not expose the plaintext session.

## Key rotation

Ciphertext records store `TELEGRAM_SESSION_KEY_VERSION`. The current implementation decrypts only the configured version. To rotate keys, deploy code that can read both old and new keys, re-encrypt all attempt/account ciphertext, then retire the old key. Changing the key or version without re-encrypting records intentionally makes them unreadable rather than silently corrupting them.

## Legacy boundary

`main.py` and `session_local.session` remain unchanged. This Step 4 service creates StringSession values for database storage, but the legacy listener still uses its SQLite session until the Step 5 multi-session worker migration.
