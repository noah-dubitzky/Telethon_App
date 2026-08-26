-- User-editable label only; original_filename remains immutable source metadata.
ALTER TABLE `media`
  ADD COLUMN `display_name` varchar(255) NULL AFTER `original_filename`;
