'use strict';
const pool = require('../public/scripts/db');

const NOT_APPROVED = { error: 'ACCOUNT_NOT_APPROVED', message: 'Your Telesaver account has not been approved yet.' };

async function sessionState(session) {
  if (!session?.userId) return 'unauthenticated';
  const [rows] = await pool.execute(
    'SELECT auth_version, status, is_approved FROM users WHERE id = ? LIMIT 1', [session.userId]
  );
  const user = rows[0];
  if (!user || user.status !== 'active') return 'unauthenticated';
  if (Number(user.is_approved) !== 1) return 'unapproved';
  return Number(user.auth_version) === Number(session.authVersion ?? 0) ? 'approved' : 'unauthenticated';
}
async function isSessionValid(session) {
  return await sessionState(session) === 'approved';
}
module.exports = { isSessionValid, sessionState, NOT_APPROVED };
