-- Track message direction so received-message views exclude the account owner's replies.
ALTER TABLE `messages`
  ADD COLUMN `is_outgoing` boolean NULL AFTER `channel_id`;

-- Best-effort backfill: messages sent by the connected Telegram identity are outgoing.
UPDATE `messages` m
JOIN `telegram_accounts` ta ON ta.`id` = m.`telegram_account_id`
LEFT JOIN `senders` s
  ON s.`id` = m.`sender_id`
 AND s.`telegram_account_id` = m.`telegram_account_id`
SET m.`is_outgoing` = CASE
  WHEN s.`external_sender_id` = ta.`telegram_user_id` THEN TRUE
  ELSE FALSE
END
WHERE m.`is_outgoing` IS NULL;

ALTER TABLE `messages`
  MODIFY COLUMN `is_outgoing` boolean NOT NULL DEFAULT FALSE;

CREATE INDEX `idx_messages_owner_direction_sent`
  ON `messages` (`telegram_account_id`, `is_outgoing`, `sent_at`, `id`);

