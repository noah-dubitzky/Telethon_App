ALTER TABLE `telegram_accounts`
  ADD COLUMN `archive_enabled` boolean NOT NULL DEFAULT TRUE AFTER `filters_enabled`;
