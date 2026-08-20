SELECT COUNT(*) AS invalid_archive_enabled_rows
FROM `telegram_accounts`
WHERE `archive_enabled` IS NULL;
