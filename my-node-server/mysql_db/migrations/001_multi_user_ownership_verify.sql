-- Read-only verification for 001_multi_user_ownership.sql
-- Every count in the ownership/orphan/cross-account sections must be zero.

USE `messaging_personal`;

-- Confirm that the migration created exactly one transitional owner/account.
SELECT 'legacy configuration rows' AS check_name, COUNT(*) AS result
FROM `legacy_single_user_config`;

SELECT
  u.`id` AS `user_id`,
  u.`status` AS `user_status`,
  ta.`id` AS `telegram_account_id`,
  ta.`display_name`,
  ta.`connection_status`
FROM `legacy_single_user_config` cfg
JOIN `telegram_accounts` ta ON ta.`id` = cfg.`telegram_account_id`
JOIN `users` u ON u.`id` = ta.`user_id`;

-- Ownership completeness: every result must be zero.
SELECT 'senders missing owner' AS check_name, COUNT(*) AS problem_count
FROM `senders` WHERE `telegram_account_id` IS NULL
UNION ALL
SELECT 'channels missing owner', COUNT(*)
FROM `channels` WHERE `telegram_account_id` IS NULL
UNION ALL
SELECT 'messages missing owner', COUNT(*)
FROM `messages` WHERE `telegram_account_id` IS NULL
UNION ALL
SELECT 'sender filters missing owner', COUNT(*)
FROM `sender_filters` WHERE `telegram_account_id` IS NULL
UNION ALL
SELECT 'channel filters missing owner', COUNT(*)
FROM `channel_filters` WHERE `telegram_account_id` IS NULL;

-- Orphan checks: every result must be zero.
SELECT 'orphan senders' AS check_name, COUNT(*) AS problem_count
FROM `senders` s
LEFT JOIN `telegram_accounts` ta ON ta.`id` = s.`telegram_account_id`
WHERE ta.`id` IS NULL
UNION ALL
SELECT 'orphan channels', COUNT(*)
FROM `channels` c
LEFT JOIN `telegram_accounts` ta ON ta.`id` = c.`telegram_account_id`
WHERE ta.`id` IS NULL
UNION ALL
SELECT 'orphan messages', COUNT(*)
FROM `messages` m
LEFT JOIN `telegram_accounts` ta ON ta.`id` = m.`telegram_account_id`
WHERE ta.`id` IS NULL
UNION ALL
SELECT 'orphan media', COUNT(*)
FROM `media` md
LEFT JOIN `messages` m ON m.`id` = md.`message_id`
WHERE m.`id` IS NULL
UNION ALL
SELECT 'orphan sender filters', COUNT(*)
FROM `sender_filters` sf
LEFT JOIN `telegram_accounts` ta ON ta.`id` = sf.`telegram_account_id`
WHERE ta.`id` IS NULL
UNION ALL
SELECT 'orphan channel filters', COUNT(*)
FROM `channel_filters` cf
LEFT JOIN `telegram_accounts` ta ON ta.`id` = cf.`telegram_account_id`
WHERE ta.`id` IS NULL;

-- Cross-account checks: both results must be zero. The composite foreign keys
-- also prevent new mismatches after migration.
SELECT 'message/sender owner mismatch' AS check_name, COUNT(*) AS problem_count
FROM `messages` m
JOIN `senders` s ON s.`id` = m.`sender_id`
WHERE m.`telegram_account_id` <> s.`telegram_account_id`
UNION ALL
SELECT 'message/channel owner mismatch', COUNT(*)
FROM `messages` m
JOIN `channels` c ON c.`id` = m.`channel_id`
WHERE m.`telegram_account_id` <> c.`telegram_account_id`;

-- Duplicate checks for stable Telegram identifiers. Legacy NULL identifiers do
-- not appear here and are intentionally preserved.
SELECT
  `telegram_account_id`,
  `telegram_chat_id`,
  `telegram_message_id`,
  COUNT(*) AS duplicate_count
FROM `messages`
WHERE `telegram_chat_id` IS NOT NULL
  AND `telegram_message_id` IS NOT NULL
GROUP BY `telegram_account_id`, `telegram_chat_id`, `telegram_message_id`
HAVING COUNT(*) > 1;

-- Confirm that all five transitional triggers exist.
SELECT `trigger_name`, `event_object_table`, `action_timing`, `event_manipulation`
FROM `information_schema`.`triggers`
WHERE `trigger_schema` = DATABASE()
  AND `trigger_name` LIKE 'trg_%_legacy_owner_before_insert'
ORDER BY `trigger_name`;

-- Preserve these totals and compare them with the pre-migration row counts.
SELECT
  (SELECT COUNT(*) FROM `senders`) AS `senders`,
  (SELECT COUNT(*) FROM `channels`) AS `channels`,
  (SELECT COUNT(*) FROM `messages`) AS `messages`,
  (SELECT COUNT(*) FROM `media`) AS `media`,
  (SELECT COUNT(*) FROM `sender_filters`) AS `sender_filters`,
  (SELECT COUNT(*) FROM `channel_filters`) AS `channel_filters`;

-- Legacy rows legitimately have NULL Telegram IDs because the old schema never
-- stored them. New identifiers become enforceable when the next route step
-- starts writing telegram_chat_id and telegram_message_id.
SELECT
  SUM(`telegram_chat_id` IS NULL) AS `legacy_messages_without_chat_id`,
  SUM(`telegram_message_id` IS NULL) AS `legacy_messages_without_message_id`
FROM `messages`;
