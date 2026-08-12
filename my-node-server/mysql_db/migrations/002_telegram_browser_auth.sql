-- Telesaver Step 4: browser-driven Telegram authentication state.
USE `messaging_personal`;

CREATE TABLE `telegram_login_attempts` (
  `id` char(36) NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `phone_number` varchar(32) NOT NULL,
  `phone_code_hash_ciphertext` blob NOT NULL,
  `temporary_session_ciphertext` mediumblob NOT NULL,
  `session_key_version` varchar(64) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'code_sent',
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_telegram_login_attempts_user_status` (`user_id`, `status`, `expires_at`),
  KEY `idx_telegram_login_attempts_expiry` (`expires_at`),
  CONSTRAINT `fk_telegram_login_attempts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A Telegram identity may only be owned by one website user. MySQL permits
-- multiple NULL values, so the migrated legacy placeholder remains valid.
ALTER TABLE `telegram_accounts`
  ADD UNIQUE KEY `uk_telegram_accounts_telegram_user` (`telegram_user_id`);
