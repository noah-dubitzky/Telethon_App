# Step 6 multi-user UI testing

The root URL checks `GET /api/auth/me`: logged-out visitors see login/sign-up and authenticated visitors go to the device-appropriate dashboard. All archive pages perform the same server-session check before becoming visible.

Public routes used are `/api/auth/me`, `/register`, `/login`, `/logout`; `/api/telegram-accounts`; and `/api/telegram-connect/start`, `/verify-code`, `/verify-password`. Calls are same-origin and use the existing HTTP-only cookie. Frontend code stores no JWT, user ID, Telegram password, session string, API credential, or worker secret.

Manual verification: register and reload; test invalid/duplicate credentials; connect Telegram through phone, code, and optional 2FA; confirm safe account status; open every dashboard page; log out and confirm direct private-page visits redirect; log back in; repeat in a second browser profile and verify archive/filter/account isolation. Existing Socket.IO should remain functional, but authenticated per-user rooms are intentionally deferred. Reconnect/disconnect controls remain absent because no public endpoints exist.
