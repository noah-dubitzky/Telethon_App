-- Message count for every channel owned by TeleSaver website user 1.
SELECT
  ta.id AS telegram_account_id,
  ta.display_name AS telegram_account_name,
  c.id AS channel_id,
  c.name AS channel_name,
  COUNT(m.id) AS message_count
FROM telegram_accounts AS ta
JOIN channels AS c
  ON c.telegram_account_id = ta.id
LEFT JOIN messages AS m
  ON m.telegram_account_id = c.telegram_account_id
 AND m.channel_id = c.id
WHERE ta.user_id = 1
GROUP BY
  ta.id,
  ta.display_name,
  c.id,
  c.name
ORDER BY
  message_count DESC,
  c.name ASC;
