# Step 2 authentication manual testing

Copy `.env.example` to `.env`, fill in the database values, and generate a long
random `SESSION_SECRET`. Start the server with `node server.js`.

The default Express memory store is used only for local development. With
`NODE_ENV=production`, sessions are stored in the shared MySQL
`website_sessions` table, which `express-mysql-session` creates when needed.
The production database user therefore needs permission to create that table on
first startup (or an operator can create it ahead of time).

The examples below use PowerShell and preserve cookies in `cookies.txt`.

```powershell
$baseUrl = 'http://localhost:3000'
$body = @{ email = 'person@example.com'; password = 'a-long-test-password' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/register" -ContentType 'application/json' -Body $body -SessionVariable webSession
Invoke-RestMethod -Uri "$baseUrl/api/auth/me" -WebSession $webSession
Invoke-RestMethod -Uri "$baseUrl/api/telegram-accounts" -WebSession $webSession
Invoke-RestMethod -Uri "$baseUrl/api/telegram-accounts/1" -WebSession $webSession
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/logout" -WebSession $webSession
Invoke-RestMethod -Uri "$baseUrl/api/auth/me" -WebSession $webSession
```

The last request should return 401. Registering the same normalized email twice
should return 409. Login can be tested in a fresh session:

```powershell
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" -ContentType 'application/json' -Body $body -SessionVariable loginSession
Invoke-RestMethod -Uri "$baseUrl/api/auth/me" -WebSession $loginSession
```

Verify hashing directly in MySQL without copying the value into logs:

```sql
SELECT id, email, password_hash IS NOT NULL AS has_hash,
       password_hash <> 'a-long-test-password' AS is_not_plaintext
FROM users
WHERE email = 'person@example.com';
```

To verify ownership isolation, create two users and associate a Telegram account
with each user in a test database. While authenticated as the first user, request
the second user's `/api/telegram-accounts/:id`; it must return the same 404 used
for a nonexistent account. Responses never select `session_ciphertext`,
`session_key_version`, or `worker_assignment`.
