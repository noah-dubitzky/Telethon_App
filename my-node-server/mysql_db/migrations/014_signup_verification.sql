-- Apply once before starting the updated server.
ALTER TABLE users ADD COLUMN email_verified_at timestamp NULL DEFAULT NULL;
CREATE TABLE pending_signups (
  id char(64) PRIMARY KEY,
  email varchar(320) NOT NULL,
  password_hash varchar(255) NOT NULL,
  code_hash varchar(255) NOT NULL,
  expires_at timestamp NOT NULL,
  sent_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts int unsigned NOT NULL DEFAULT 0,
  sends int unsigned NOT NULL DEFAULT 1,
  INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE signup_limits (
  bucket char(64) PRIMARY KEY,
  attempts int unsigned NOT NULL,
  resets_at timestamp NOT NULL,
  INDEX (resets_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
