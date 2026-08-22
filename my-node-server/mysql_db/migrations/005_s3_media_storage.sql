-- Preserve path for existing locally stored media; new media uses s3_key.
ALTER TABLE `media`
  MODIFY COLUMN `path` varchar(1024) NULL,
  ADD COLUMN `s3_key` varchar(512) NULL AFTER `path`,
  ADD COLUMN `original_filename` varchar(255) NULL AFTER `s3_key`,
  ADD COLUMN `mime_type` varchar(255) NULL AFTER `original_filename`,
  ADD COLUMN `file_size` bigint unsigned NULL AFTER `mime_type`,
  ADD COLUMN `media_type` enum('images','videos','audio','documents','stickers','voice','other') NULL AFTER `file_size`,
  ADD UNIQUE KEY `uk_media_s3_key` (`s3_key`);
