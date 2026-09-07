-- Apply once before deploying the profile editing routes.
ALTER TABLE users
  ADD COLUMN display_name varchar(100) DEFAULT NULL,
  ADD COLUMN auth_version int unsigned NOT NULL DEFAULT 0;

CREATE TABLE user_email_changes (
  user_id bigint unsigned NOT NULL PRIMARY KEY,
  new_email varchar(320) NOT NULL,
  code_hash char(64) NOT NULL,
  expires_at timestamp NOT NULL,
  attempts tinyint unsigned NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_security_limits (
  user_id bigint unsigned NOT NULL,
  action varchar(32) NOT NULL,
  attempts int unsigned NOT NULL DEFAULT 1,
  resets_at timestamp NOT NULL,
  PRIMARY KEY (user_id, action),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
