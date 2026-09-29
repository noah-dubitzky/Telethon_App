-- Apply ONCE, after migrations 001-012, with Node and Python stopped.
-- Review SHOW COLUMNS FROM users and SELECT id,email,status FROM users first.
-- Explicit backfill policy: preserve access for ALL existing active accounts
-- with credentials. Review that population before running; placeholders and
-- inactive accounts remain unapproved. New registrations always default FALSE.
-- MySQL DDL implicitly commits. Take a verified snapshot before applying.
-- The inspected deployment still has a legacy unique index on a constant
-- generated singleton_guard column. It prevents EVERY second registration.
-- Remove only that obsolete index, if present; retain all existing columns.
SET @approval_drop_singleton = IF(EXISTS(
  SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_users_singleton'
), 'ALTER TABLE users DROP INDEX uk_users_singleton', 'SELECT 1');
PREPARE approval_statement FROM @approval_drop_singleton;
EXECUTE approval_statement;
DEALLOCATE PREPARE approval_statement;

ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_approved = TRUE
 WHERE id > 0 AND status = 'active' AND email IS NOT NULL AND password_hash IS NOT NULL;

CREATE TABLE admins (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  auth_version int unsigned NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_sessions (
  session_id varchar(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires int unsigned NOT NULL,
  data mediumtext COLLATE utf8mb4_bin
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_login_limits (
  bucket char(64) NOT NULL PRIMARY KEY,
  attempts int unsigned NOT NULL DEFAULT 1,
  resets_at timestamp NOT NULL,
  KEY (resets_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
