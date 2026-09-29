'use strict';
require('dotenv').config({ quiet: true });
const readline = require('readline/promises');
const { Writable } = require('stream');
const bcrypt = require('bcryptjs');
const pool = require('../public/scripts/db');

async function main() {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,100}$/.test(username) || !process.stdin.isTTY) {
    throw new Error('Run interactively: node scripts/create-admin.js USERNAME [--reset]');
  }
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  let password;
  try {
    process.stdout.write('Admin password (hidden): ');
    password = await prompt.question('');
    process.stdout.write('\nConfirm password (hidden): ');
    const confirmation = await prompt.question('');
    if (password !== confirmation) throw new Error('Passwords do not match');
    if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Use at least 12 characters and at most 72 UTF-8 bytes');
  } finally { prompt.close(); process.stdout.write('\n'); }
  const hash = await bcrypt.hash(password, 12);
  if (process.argv.includes('--reset')) {
    const [result] = await pool.execute('UPDATE admins SET password_hash = ?, auth_version = auth_version + 1 WHERE username = ?', [hash, username]);
    if (!result.affectedRows) throw new Error('Administrator does not exist');
  } else {
    await pool.execute('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
  }
  console.log('Administrator credentials saved.');
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
