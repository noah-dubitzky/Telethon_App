'use strict';
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

module.exports = function adminSession() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Admin session secret must have at least 32 characters');
  const store = process.env.NODE_ENV === 'production' ? new MySQLStore({
    createDatabaseTable: false, schema: { tableName: 'admin_sessions' }
  }, {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'messaging_personal'
  }) : new session.MemoryStore();
  return session({ name: 'telesaver.admin.sid', secret, store,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      path: '/api/admin', maxAge: 1000 * 60 * 60 * 4 } });
};
