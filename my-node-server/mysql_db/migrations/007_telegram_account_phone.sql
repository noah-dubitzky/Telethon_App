-- Persist the verified login phone number for account identification in the UI.
ALTER TABLE `telegram_accounts`
  ADD COLUMN `phone_number` varchar(32) NULL AFTER `display_name`;

