// routes/messages.js
const express = require('express');
const router = express.Router();
const pool = require('../db'); // import pool

// Test route (ping)
router.get('/ping', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS now');
    res.json({ message: '✅ DB is working!', server_time: rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '❌ Database error', details: err.message });
  }
});

// Example route: get all messages (later we’ll refine it)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM messages ORDER BY sent_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '❌ Database error', details: err.message });
  }
});

module.exports = router;
