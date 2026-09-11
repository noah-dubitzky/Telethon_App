SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'user_storage_settings' AND COLUMN_NAME IN
    ('text_retention_days', 'media_retention_days', 'pdf_retention_days'))
    OR (TABLE_NAME IN ('messages', 'media') AND COLUMN_NAME = 'saved_at'));
-- Expect five rows. All three retention periods are nullable.
SELECT COUNT(*) AS enabled_retention_users FROM user_storage_settings
WHERE text_retention_days IS NOT NULL OR media_retention_days IS NOT NULL OR pdf_retention_days IS NOT NULL;
-- Immediately after migration this is zero; saving retention can increase it.
