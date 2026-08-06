-- Telesaver Step 1: multi-user ownership foundation
-- Target: MySQL 8.0
--
-- IMPORTANT:
--   1. Take and verify an RDS snapshot before running this file.
--   2. Stop the Python and Node PM2 processes while it runs.
--   3. Run this migration exactly once against the current single-user schema.
--   4. Do not connect a second Telegram account while the transitional triggers
--      at the end of this file are enabled.
--
-- MySQL DDL statements implicitly commit. A failed migration cannot be safely
-- rolled back with ROLLBACK; restore the pre-migration snapshot instead.

USE `messaging_personal`;

-- MySQL Workbench commonly enables SQL_SAFE_UPDATES. The ownership backfill is
-- intentionally table-wide, so disable it only for this migration and restore
-- the session's original value at the end.
SET @step1_old_sql_safe_updates := @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

-- The legacy owner is intentionally not login-capable yet. Step 2 will collect
-- a real email/password hash through the website authentication work.
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(320) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'migration_pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Session ciphertext is only a schema placeholder in Step 1. This migration
-- does not copy, encrypt, or expose the existing Telethon session file.
CREATE TABLE `telegram_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `telegram_user_id` bigint DEFAULT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `session_ciphertext` mediumblob DEFAULT NULL,
  `session_key_version` varchar(64) DEFAULT NULL,
  `connection_status` varchar(32) NOT NULL DEFAULT 'disconnected',
  `worker_assignment` varchar(255) DEFAULT NULL,
  `connected_at` datetime DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_telegram_accounts_user_telegram` (`user_id`, `telegram_user_id`),
  KEY `idx_telegram_accounts_user_status` (`user_id`, `connection_status`),
  CONSTRAINT `fk_telegram_accounts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Create the one legacy owner/account without assuming either generated ID is 1.
-- NULL email/password values prevent this placeholder from being used to log in.
INSERT INTO `users` (`email`, `password_hash`, `status`)
VALUES (NULL, NULL, 'migration_pending');
SET @legacy_user_id := LAST_INSERT_ID();

INSERT INTO `telegram_accounts`
  (`user_id`, `telegram_user_id`, `display_name`, `connection_status`)
VALUES
  (@legacy_user_id, NULL, 'Legacy Telegram account', 'disconnected');
SET @legacy_telegram_account_id := LAST_INSERT_ID();

-- This singleton is a temporary bridge for the current routes. The browser
-- cannot select this value. Database triggers read it when the old Node inserts
-- omit telegram_account_id. Step 3 must remove this table and the triggers after
-- every route derives ownership from authenticated server-side context.
CREATE TABLE `legacy_single_user_config` (
  `singleton_id` tinyint unsigned NOT NULL,
  `telegram_account_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`singleton_id`),
  UNIQUE KEY `uk_legacy_single_user_account` (`telegram_account_id`),
  CONSTRAINT `chk_legacy_singleton_id` CHECK (`singleton_id` = 1),
  CONSTRAINT `fk_legacy_single_user_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `legacy_single_user_config` (`singleton_id`, `telegram_account_id`)
VALUES (1, @legacy_telegram_account_id);

-- Add ownership as nullable first so existing rows can be backfilled safely.
-- Signed BIGINT is used for Telegram chat IDs because Telethon marked peer IDs
-- for groups/channels can be negative (for example, -100...).
ALTER TABLE `senders`
  ADD COLUMN `telegram_account_id` bigint unsigned DEFAULT NULL AFTER `id`;

ALTER TABLE `channels`
  ADD COLUMN `telegram_account_id` bigint unsigned DEFAULT NULL AFTER `id`,
  ADD COLUMN `telegram_chat_id` bigint DEFAULT NULL AFTER `telegram_account_id`;

ALTER TABLE `messages`
  ADD COLUMN `telegram_account_id` bigint unsigned DEFAULT NULL AFTER `id`,
  ADD COLUMN `telegram_chat_id` bigint DEFAULT NULL AFTER `telegram_account_id`,
  ADD COLUMN `telegram_message_id` bigint DEFAULT NULL AFTER `telegram_chat_id`;

ALTER TABLE `sender_filters`
  ADD COLUMN `telegram_account_id` bigint unsigned DEFAULT NULL AFTER `id`;

ALTER TABLE `channel_filters`
  ADD COLUMN `telegram_account_id` bigint unsigned DEFAULT NULL AFTER `id`,
  ADD COLUMN `telegram_chat_id` bigint DEFAULT NULL AFTER `telegram_account_id`;

-- Every legacy Telegram-derived row belongs to the one migrated account.
UPDATE `senders`
SET `telegram_account_id` = @legacy_telegram_account_id
WHERE `telegram_account_id` IS NULL;

UPDATE `channels`
SET `telegram_account_id` = @legacy_telegram_account_id
WHERE `telegram_account_id` IS NULL;

UPDATE `messages`
SET `telegram_account_id` = @legacy_telegram_account_id
WHERE `telegram_account_id` IS NULL;

UPDATE `sender_filters`
SET `telegram_account_id` = @legacy_telegram_account_id
WHERE `telegram_account_id` IS NULL;

UPDATE `channel_filters`
SET `telegram_account_id` = @legacy_telegram_account_id
WHERE `telegram_account_id` IS NULL;

-- Abort before adding NOT NULL/FK constraints if any ownership backfill failed.
DELIMITER //
CREATE PROCEDURE `assert_step1_ownership_backfill`()
BEGIN
  IF EXISTS (SELECT 1 FROM `senders` WHERE `telegram_account_id` IS NULL LIMIT 1)
     OR EXISTS (SELECT 1 FROM `channels` WHERE `telegram_account_id` IS NULL LIMIT 1)
     OR EXISTS (SELECT 1 FROM `messages` WHERE `telegram_account_id` IS NULL LIMIT 1)
     OR EXISTS (SELECT 1 FROM `sender_filters` WHERE `telegram_account_id` IS NULL LIMIT 1)
     OR EXISTS (SELECT 1 FROM `channel_filters` WHERE `telegram_account_id` IS NULL LIMIT 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Step 1 ownership backfill failed: NULL owners remain';
  END IF;
END//
DELIMITER ;

CALL `assert_step1_ownership_backfill`();
DROP PROCEDURE `assert_step1_ownership_backfill`;

-- Ownership is mandatory after the verified backfill.
ALTER TABLE `senders`
  MODIFY COLUMN `telegram_account_id` bigint unsigned NOT NULL;

ALTER TABLE `channels`
  MODIFY COLUMN `telegram_account_id` bigint unsigned NOT NULL;

ALTER TABLE `messages`
  MODIFY COLUMN `telegram_account_id` bigint unsigned NOT NULL;

ALTER TABLE `sender_filters`
  MODIFY COLUMN `telegram_account_id` bigint unsigned NOT NULL;

ALTER TABLE `channel_filters`
  MODIFY COLUMN `telegram_account_id` bigint unsigned NOT NULL;

-- Replace global uniqueness with per-Telegram-account uniqueness.
-- The scoped channel-name key is transitional: current Node inserts identify a
-- channel only by name. It can be removed after routes use telegram_chat_id.
ALTER TABLE `senders`
  DROP INDEX `uk_senders_external`,
  ADD UNIQUE KEY `uk_senders_account_external`
    (`telegram_account_id`, `external_sender_id`),
  ADD UNIQUE KEY `uk_senders_account_internal`
    (`telegram_account_id`, `id`),
  ADD KEY `idx_senders_account_name` (`telegram_account_id`, `name`);

ALTER TABLE `channels`
  DROP INDEX `uk_channels_name`,
  ADD UNIQUE KEY `uk_channels_account_chat`
    (`telegram_account_id`, `telegram_chat_id`),
  ADD UNIQUE KEY `uk_channels_account_name_legacy`
    (`telegram_account_id`, `name`),
  ADD UNIQUE KEY `uk_channels_account_internal`
    (`telegram_account_id`, `id`);

ALTER TABLE `sender_filters`
  DROP INDEX `external_sender_id`,
  ADD UNIQUE KEY `uk_sender_filters_account_external`
    (`telegram_account_id`, `external_sender_id`),
  ADD KEY `idx_sender_filters_account_name`
    (`telegram_account_id`, `name`);

ALTER TABLE `channel_filters`
  DROP INDEX `channel_key`,
  ADD UNIQUE KEY `uk_channel_filters_account_chat`
    (`telegram_account_id`, `telegram_chat_id`),
  ADD UNIQUE KEY `uk_channel_filters_account_key_legacy`
    (`telegram_account_id`, `channel_key`);

-- Remove the old single-column relationships. The replacement composite FKs
-- prove that a message and its sender/channel have the same account owner.
ALTER TABLE `messages`
  DROP FOREIGN KEY `fk_messages_sender`,
  DROP FOREIGN KEY `fk_messages_channel`,
  ADD UNIQUE KEY `uk_messages_account_chat_message`
    (`telegram_account_id`, `telegram_chat_id`, `telegram_message_id`),
  ADD KEY `idx_messages_account_sent`
    (`telegram_account_id`, `sent_at`, `id`),
  ADD KEY `idx_messages_account_sender_sent`
    (`telegram_account_id`, `sender_id`, `sent_at`, `id`),
  ADD KEY `idx_messages_account_channel_sent`
    (`telegram_account_id`, `channel_id`, `sent_at`, `id`),
  ADD CONSTRAINT `fk_messages_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_messages_account_sender`
    FOREIGN KEY (`telegram_account_id`, `sender_id`)
    REFERENCES `senders` (`telegram_account_id`, `id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_messages_account_channel`
    FOREIGN KEY (`telegram_account_id`, `channel_id`)
    REFERENCES `channels` (`telegram_account_id`, `id`) ON DELETE RESTRICT;

ALTER TABLE `senders`
  ADD CONSTRAINT `fk_senders_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT;

ALTER TABLE `channels`
  ADD CONSTRAINT `fk_channels_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT;

ALTER TABLE `sender_filters`
  ADD CONSTRAINT `fk_sender_filters_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT;

ALTER TABLE `channel_filters`
  ADD CONSTRAINT `fk_channel_filters_account`
    FOREIGN KEY (`telegram_account_id`)
    REFERENCES `telegram_accounts` (`id`) ON DELETE RESTRICT;

-- Media ownership remains normalized through its message. Cascading here only
-- removes media metadata after its parent message is deliberately deleted.
ALTER TABLE `media`
  DROP FOREIGN KEY `fk_media_message`;

-- Use a new name because MySQL can report the old constraint as a duplicate
-- when a drop and same-name recreation are combined in one ALTER statement.
ALTER TABLE `media`
  ADD CONSTRAINT `fk_media_message_cascade`
    FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE;

-- Temporary compatibility triggers for the unchanged single-user Node routes.
-- These triggers are deliberately server/database controlled; ownership never
-- comes from a browser field. Remove them before enabling multiple accounts.
DELIMITER //

CREATE TRIGGER `trg_senders_legacy_owner_before_insert`
BEFORE INSERT ON `senders`
FOR EACH ROW
BEGIN
  IF NEW.`telegram_account_id` IS NULL THEN
    SET NEW.`telegram_account_id` = (
      SELECT `telegram_account_id`
      FROM `legacy_single_user_config`
      WHERE `singleton_id` = 1
    );
  END IF;
END//

CREATE TRIGGER `trg_channels_legacy_owner_before_insert`
BEFORE INSERT ON `channels`
FOR EACH ROW
BEGIN
  IF NEW.`telegram_account_id` IS NULL THEN
    SET NEW.`telegram_account_id` = (
      SELECT `telegram_account_id`
      FROM `legacy_single_user_config`
      WHERE `singleton_id` = 1
    );
  END IF;
END//

CREATE TRIGGER `trg_messages_legacy_owner_before_insert`
BEFORE INSERT ON `messages`
FOR EACH ROW
BEGIN
  IF NEW.`telegram_account_id` IS NULL THEN
    SET NEW.`telegram_account_id` = (
      SELECT `telegram_account_id`
      FROM `legacy_single_user_config`
      WHERE `singleton_id` = 1
    );
  END IF;
END//

CREATE TRIGGER `trg_sender_filters_legacy_owner_before_insert`
BEFORE INSERT ON `sender_filters`
FOR EACH ROW
BEGIN
  IF NEW.`telegram_account_id` IS NULL THEN
    SET NEW.`telegram_account_id` = (
      SELECT `telegram_account_id`
      FROM `legacy_single_user_config`
      WHERE `singleton_id` = 1
    );
  END IF;
END//

CREATE TRIGGER `trg_channel_filters_legacy_owner_before_insert`
BEFORE INSERT ON `channel_filters`
FOR EACH ROW
BEGIN
  IF NEW.`telegram_account_id` IS NULL THEN
    SET NEW.`telegram_account_id` = (
      SELECT `telegram_account_id`
      FROM `legacy_single_user_config`
      WHERE `singleton_id` = 1
    );
  END IF;
END//

DELIMITER ;

-- Run 001_multi_user_ownership_verify.sql immediately after this migration.
SET SQL_SAFE_UPDATES = @step1_old_sql_safe_updates;
