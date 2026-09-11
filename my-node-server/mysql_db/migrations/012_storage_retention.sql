-- Apply once after 011_storage_settings.sql, before restarting Node.
-- Existing text/media begin their retention clock at migration time.
ALTER TABLE user_storage_settings
  ADD COLUMN text_retention_days int unsigned DEFAULT NULL,
  ADD COLUMN media_retention_days int unsigned DEFAULT NULL,
  ADD COLUMN pdf_retention_days int unsigned DEFAULT NULL;
ALTER TABLE messages
  ADD COLUMN saved_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD KEY idx_messages_saved_at (saved_at, id);
ALTER TABLE media
  ADD COLUMN saved_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD KEY idx_media_saved_at (saved_at, id);
-- PDF exports already have a reliable created_at timestamp.
