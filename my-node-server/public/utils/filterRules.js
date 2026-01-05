const pool = require('../scripts/db'); // MySQL connection pool (public/scripts/db.js)

const DEFAULT_ALLOW_SENDERS = true;
const DEFAULT_ALLOW_CHANNELS = false;

/**
 * Decide whether a message should be saved.
 * Channel rules override sender rules.
 * FAIL OPEN: returns true on error.
 */
async function isMessageAllowed({ external_sender_id, channel_key }) {
  try {
    // 1️⃣ Channel rule (highest priority)
    if (channel_key) {
      const [channelRows] = await pool.query(
        'SELECT mode FROM channel_filters WHERE channel_key = ? LIMIT 1',
        [channel_key]
      );

      if (channelRows.length) {
        return channelRows[0].mode === 'allow';
      }else{

        return DEFAULT_ALLOW_CHANNELS;
      }
    }

    // 2️⃣ Sender rule
    if (external_sender_id) {
      const [senderRows] = await pool.query(
        'SELECT mode FROM sender_filters WHERE external_sender_id = ? LIMIT 1',
        [external_sender_id]
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
