const pool = require('../scripts/db'); // MySQL connection pool (public/scripts/db.js)

const DEFAULT_ALLOW_SENDERS = true;
const DEFAULT_ALLOW_CHANNELS = true;

/**
 * Decide whether a message should be saved.
 * Channel rules override sender rules.
 * FAIL OPEN: returns true on error.
 */
async function isMessageAllowed({ telegram_account_id, external_sender_id, sender_name, channel_key }) {
  try {
    // The unchanged legacy worker does not send an account ID yet. Resolve its
    // server-controlled compatibility account; never accept a website user ID.
    let accountId = telegram_account_id;
    if (!accountId) {
      const [legacyRows] = await pool.query(
        'SELECT telegram_account_id FROM legacy_single_user_config WHERE singleton_id = 1 LIMIT 1'
      );
      accountId = legacyRows[0]?.telegram_account_id;
    }
    if (!accountId) throw new Error('No trusted Telegram account was resolved');
    // 1️⃣ Channel rule (highest priority)
    if (channel_key) {
      const [channelRows] = await pool.query(
        'SELECT mode FROM channel_filters WHERE telegram_account_id = ? AND channel_key = ? LIMIT 1',
        [accountId, channel_key]
      );

      if (channelRows.length) {

        return channelRows[0].mode === 'allow';

      }else{

        return DEFAULT_ALLOW_CHANNELS;
      }

    }

    // 2️⃣ Sender rule
    if (external_sender_id || sender_name) {
      const [senderRows] = await pool.query(
        `SELECT mode FROM sender_filters
         WHERE telegram_account_id = ? AND (external_sender_id = ? OR name = ?) LIMIT 1`,
        [accountId, external_sender_id, sender_name]
      );

      if (senderRows.length) {
        return senderRows[0].mode === 'allow';
      }else{
        
        return DEFAULT_ALLOW_SENDERS;
      }
    }

    // 3️⃣ Defaults
    return false;

  } catch (err) {
    console.error('[filterRules] failed, allowing message:', err);
    return true; // 🚨 fail open
  }
}

module.exports = {
  isMessageAllowed
};
