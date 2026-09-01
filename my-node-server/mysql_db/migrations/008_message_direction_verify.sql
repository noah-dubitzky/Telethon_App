SELECT COUNT(*) AS direction_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'messages'
  AND column_name = 'is_outgoing';

SELECT COUNT(*) AS direction_index_count
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'messages'
  AND index_name = 'idx_messages_owner_direction_sent';

