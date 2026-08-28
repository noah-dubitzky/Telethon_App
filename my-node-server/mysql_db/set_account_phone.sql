-- Apply migration 007_telegram_account_phone.sql before running this script.
-- Replace all three values below with the intended account information.
SET @website_user_id = 1;
SET @telegram_account_id = 1;
SET @telegram_phone_number = '+15551234567';

START TRANSACTION;

-- The user/account pair prevents changing an account owned by another user.
-- The regular expression requires an E.164-style international phone number.
UPDATE `telegram_accounts`
SET `phone_number` = @telegram_phone_number
WHERE `id` = @telegram_account_id
  AND `user_id` = @website_user_id
  AND @telegram_phone_number REGEXP '^\\+[1-9][0-9]{7,14}$';

-- Confirm the stored value before committing.
SELECT
  `id`,
  `user_id`,
  `display_name`,
  `phone_number`
FROM `telegram_accounts`
WHERE `id` = @telegram_account_id
  AND `user_id` = @website_user_id;

COMMIT;
