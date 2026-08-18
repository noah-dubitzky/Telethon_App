-- Step 8: account-level filter bypass switch.
-- Non-destructive: existing accounts retain current filtering behavior.
USE `messaging_personal`;

ALTER TABLE `telegram_accounts`
  ADD COLUMN `filters_enabled` boolean NOT NULL DEFAULT TRUE
  AFTER `connection_status`;
