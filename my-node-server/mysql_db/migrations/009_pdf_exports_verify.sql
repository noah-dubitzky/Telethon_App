-- Run after 009_pdf_exports.sql.
USE `messaging_personal`;

SELECT
  `table_name`,
  `engine`,
  `table_collation`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN ('pdf_exports', 'pdf_export_senders')
ORDER BY `table_name`;

SELECT
  `table_name`,
  `column_name`,
  `column_type`,
  `is_nullable`
FROM `information_schema`.`columns`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN ('pdf_exports', 'pdf_export_senders')
ORDER BY `table_name`, `ordinal_position`;

SELECT
  `table_name`,
  `constraint_name`,
  `constraint_type`
FROM `information_schema`.`table_constraints`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN ('pdf_exports', 'pdf_export_senders')
ORDER BY `table_name`, `constraint_type`, `constraint_name`;

-- These should both return zero for a newly applied migration.
SELECT COUNT(*) AS `pdf_export_count` FROM `pdf_exports`;
SELECT COUNT(*) AS `pdf_export_sender_count` FROM `pdf_export_senders`;

