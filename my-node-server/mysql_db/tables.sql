-- Use utf8mb4 for full Unicode
CREATE DATABASE IF NOT EXISTS messaging
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE messaging;

CREATE TABLE senders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_sender_id VARCHAR(64) NOT NULL,   -- from sender_id in your dict
  name VARCHAR(255) NULL,                    -- sender_name
  phone VARCHAR(32) NULL,                    -- sender_phone
  PRIMARY KEY (id),
  UNIQUE KEY uk_senders_external (external_sender_id),
  UNIQUE KEY uk_senders_phone (phone)
) ENGINE=InnoDB;

CREATE TABLE channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,                -- channel_name
  PRIMARY KEY (id),
  UNIQUE KEY uk_channels_name (name)
) ENGINE=InnoDB;

CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_id BIGINT UNSIGNED NOT NULL,        -- FK -> senders.id
  channel_id BIGINT UNSIGNED NULL,           -- FK -> channels.id
  sent_at DATETIME NOT NULL,                 -- timestamp
  text MEDIUMTEXT NULL,                      -- text
  PRIMARY KEY (id),
  KEY idx_messages_sent_at (sent_at),
  FULLTEXT KEY ft_messages_text (text),      -- optional: enables full-text search
  CONSTRAINT fk_messages_sender  FOREIGN KEY (sender_id)  REFERENCES senders(id),
  CONSTRAINT fk_messages_channel FOREIGN KEY (channel_id) REFERENCES channels(id)
) ENGINE=InnoDB;

-- If a message has at most one media file, keep UNIQUE on message_id.
-- If messages can have multiple media files, remove the UNIQUE constraint.
CREATE TABLE media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,       -- FK -> messages.id
  path VARCHAR(1024) NOT NULL,               -- media_path
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_message (message_id),
  CONSTRAINT fk_media_message FOREIGN KEY (message_id) REFERENCES messages(id)
) ENGINE=InnoDB;
