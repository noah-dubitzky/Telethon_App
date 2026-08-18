USE `messaging_personal`;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'telegram_accounts'
  AND COLUMN_NAME = 'filters_enabled';

SELECT COUNT(*) AS accounts_with_invalid_filter_state
FROM telegram_accounts
WHERE filters_enabled NOT IN (0, 1) OR filters_enabled IS NULL;
