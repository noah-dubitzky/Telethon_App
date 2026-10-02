Apply `mysql_db/migrations/014_signup_verification.sql` once to the application database before starting the updated Node server. Existing users retain their login access; their new `email_verified_at` field is left null.

Configure the existing mail sender with `SMTP_HOST`, `SMTP_PORT` (587 by default, or 465), `SMTP_FROM`, and, where required, `SMTP_USER` and `SMTP_PASSWORD`. See `PROFILE_EDITING_SETUP.md` for the shared SMTP configuration. Without a configured sender, signup returns an error and leaves the form editable.

Signup sends a six-digit code valid for ten minutes. The same form then hides the credential fields and displays the code field, resend button, and create-account button. Pending signup stores only bcrypt hashes for the password and code. Codes allow five incorrect attempts total per signup; resending does not reset that allowance. Resends have a 60-second cooldown and a five-email limit. Database-backed request limits apply per IP and initial email address. Expired pending records are removed in small batches on subsequent signup requests.

Verification consumes the pending record and creates the user within one transaction. New users have a verification timestamp but still require administrator approval. The legacy `/api/auth/register` endpoint also requires a signup identifier and code. Editing signup details cancels the pending record; refreshing the page requires starting again.

Run `node test/signupVerification.test.cjs` and `npm run test:approval` from `my-node-server`. Tests use mocked mail and database operations; validate migration execution and actual SMTP delivery in the deployment environment.
