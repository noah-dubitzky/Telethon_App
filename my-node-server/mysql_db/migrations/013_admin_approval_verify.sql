SHOW COLUMNS FROM users LIKE 'is_approved';
-- uk_users_singleton must be absent; uk_users_email must remain unique.
SHOW INDEX FROM users;
SELECT id, email, status, is_approved, auth_version FROM users ORDER BY id;
SHOW COLUMNS FROM admins;
SHOW COLUMNS FROM admin_sessions;
SHOW COLUMNS FROM admin_login_limits;
-- Expect zero: approval must not activate an otherwise inactive account.
SELECT COUNT(*) AS unexpected_approvals FROM users WHERE status <> 'active' AND is_approved = TRUE;
