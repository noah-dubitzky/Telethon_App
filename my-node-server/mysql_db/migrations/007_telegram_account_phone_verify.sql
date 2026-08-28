SELECT COUNT(*) AS phone_number_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'telegram_accounts'
  AND column_name = 'phone_number';
