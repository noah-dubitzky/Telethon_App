-- script is not needed

use messaging;

ALTER TABLE Messages
ADD COLUMN media_path VARCHAR(255) AFTER messages;