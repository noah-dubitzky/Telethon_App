CREATE TABLE IF NOT EXISTS user_storage_settings (
  user_id bigint unsigned NOT NULL PRIMARY KEY,
  save_text boolean NOT NULL DEFAULT TRUE,
  save_photos boolean NOT NULL DEFAULT TRUE,
  save_videos boolean NOT NULL DEFAULT TRUE,
  save_audio boolean NOT NULL DEFAULT TRUE,
  save_files boolean NOT NULL DEFAULT TRUE,
  save_pdfs boolean NOT NULL DEFAULT TRUE,
  max_file_size_mb int unsigned DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
