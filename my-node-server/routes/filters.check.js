const express = require('express');
const router = express.Router();
const { isMessageAllowed } = require('../public/utils/filterRules.js');

router.post('/filters/check', async (req, res) => {
  const { external_sender_id, channel_key } = req.body;

  const allowed = await isMessageAllowed({
    external_sender_id,
    channel_key
  });

  res.json({ allowed });
});

module.exports = router;
