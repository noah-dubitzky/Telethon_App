-- TeleSaver Step 12: persisted PDF export metadata and sender membership.
-- Target: MySQL 8.0
--
-- IMPORTANT:
--   1. Take and verify an RDS snapshot before running this migration.
--   2. Run this file, followed by 009_pdf_exports_verify.sql. The prerequisite
--      indexes and new tables are guarded so an interrupted run can resume.
--   3. This migration creates metadata tables only; application code will
--      upload generated PDFs and populate these records in a later change.

USE `messaging_personal`;

-- Composite candidate keys let export foreign keys prove that the website
-- user, Telegram account, and boundary messages all belong together.
SET @step12_add_account_owner_key := IF(
  EXISTS (
    SELECT 1
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'telegram_accounts'
      AND `index_name` = 'uk_telegram_accounts_id_user'
  ),
  'SELECT 1',
  'ALTER TABLE `telegram_accounts` ADD UNIQUE KEY `uk_telegram_accounts_id_user` (`id`, `user_id`)'
);
PREPARE `step12_account_owner_stmt` FROM @step12_add_account_owner_key;
EXECUTE `step12_account_owner_stmt`;
DEALLOCATE PREPARE `step12_account_owner_stmt`;

SET @step12_add_message_account_key := IF(
  EXISTS (
    SELECT 1
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'messages'
      AND `index_name` = 'uk_messages_account_internal'
  ),
  'SELECT 1',
  'ALTER TABLE `messages` ADD UNIQUE KEY `uk_messages_account_internal` (`telegram_account_id`, `id`)'
);
PREPARE `step12_message_account_stmt` FROM @step12_add_message_account_key;
EXECUTE `step12_message_account_stmt`;
DEALLOCATE PREPARE `step12_message_account_stmt`;

CREATE TABLE IF NOT EXISTS `pdf_exports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `telegram_account_id` bigint unsigned NOT NULL,

  -- A direct conversation is identified by its peer sender and Telegram chat.
  -- A channel conversation is identified by its channel and Telegram chat.
  `conversation_type` enum('direct','channel') NOT NULL,
  `telegram_chat_id` bigint NOT NULL,
  `sender_id` bigint unsigned DEFAULT NULL,
  `channel_id` bigint unsigned DEFAULT NULL,

  -- Immutable storage/source metadata plus a user-facing export name.
  `export_name` varchar(255) NOT NULL,
  `storage_key` varchar(512) NOT NULL,
  `file_size` bigint unsigned DEFAULT NULL,
  `mime_type` varchar(127) NOT NULL DEFAULT 'application/pdf',

  -- The exported range makes the contents auditable without duplicating
  -- message bodies in this table.
  `first_message_id` bigint unsigned DEFAULT NULL,
  `last_message_id` bigint unsigned DEFAULT NULL,
  `message_count` int unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pdf_exports_storage_key` (`storage_key`),
  UNIQUE KEY `uk_pdf_exports_id_account` (`id`, `telegram_account_id`),
  KEY `idx_pdf_exports_user_created` (`user_id`, `created_at`, `id`),
  KEY `idx_pdf_exports_account_chat` (`telegram_account_id`, `telegram_chat_id`, `created_at`),
  KEY `idx_pdf_exports_account_sender` (`telegram_account_id`, `sender_id`),
  KEY `idx_pdf_exports_account_channel` (`telegram_account_id`, `channel_id`),
  KEY `idx_pdf_exports_first_message` (`telegram_account_id`, `first_message_id`),
  KEY `idx_pdf_exports_last_message` (`telegram_account_id`, `last_message_id`),

  CONSTRAINT `chk_pdf_exports_conversation_target` CHECK (
    (`conversation_type` = 'direct' AND `sender_id` IS NOT NULL AND `channel_id` IS NULL)
    OR
    (`conversation_type` = 'channel' AND `channel_id` IS NOT NULL AND `sender_id` IS NULL)
  ),
  CONSTRAINT `chk_pdf_exports_pdf_mime` CHECK (`mime_type` = 'application/pdf'),
  CONSTRAINT `chk_pdf_exports_message_range` CHECK (
    (`first_message_id` IS NULL AND `last_message_id` IS NULL AND `message_count` = 0)
    OR
    (`first_message_id` IS NOT NULL AND `last_message_id` IS NOT NULL AND `message_count` > 0)
  ),
  CONSTRAINT `fk_pdf_exports_account_owner`
    FOREIGN KEY (`telegram_account_id`, `user_id`)
    REFERENCES `telegram_accounts` (`id`, `user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pdf_exports_account_sender`
    FOREIGN KEY (`telegram_account_id`, `sender_id`)
    REFERENCES `senders` (`telegram_account_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pdf_exports_account_channel`
    FOREIGN KEY (`telegram_account_id`, `channel_id`)
    REFERENCES `channels` (`telegram_account_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pdf_exports_first_message`
    FOREIGN KEY (`telegram_account_id`, `first_message_id`)
    REFERENCES `messages` (`telegram_account_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pdf_exports_last_message`
    FOREIGN KEY (`telegram_account_id`, `last_message_id`)
    REFERENCES `messages` (`telegram_account_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per distinct observed sender whose message appears in an export.
-- telegram_account_id participates in both foreign keys, preventing an export
-- from being associated with a sender belonging to another Telegram account.
-- The name snapshot preserves the label printed in the PDF if it later changes.
CREATE TABLE IF NOT EXISTS `pdf_export_senders` (
  `pdf_export_id` bigint unsigned NOT NULL,
  `telegram_account_id` bigint unsigned NOT NULL,
  `sender_id` bigint unsigned NOT NULL,
  `sender_name_at_export` varchar(255) DEFAULT NULL,
  `message_count` int unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`pdf_export_id`, `sender_id`),
  KEY `idx_pdf_export_senders_account_sender`
    (`telegram_account_id`, `sender_id`, `pdf_export_id`),
  CONSTRAINT `chk_pdf_export_senders_message_count`
    CHECK (`message_count` > 0),
  CONSTRAINT `fk_pdf_export_senders_export_account`
    FOREIGN KEY (`pdf_export_id`, `telegram_account_id`)
    REFERENCES `pdf_exports` (`id`, `telegram_account_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pdf_export_senders_account_sender`
    FOREIGN KEY (`telegram_account_id`, `sender_id`)
    REFERENCES `senders` (`telegram_account_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
