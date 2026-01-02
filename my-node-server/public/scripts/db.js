// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'database-2.cbiyuoea456d.us-east-1.rds.amazonaws.com',
  port: 3306,
  user: 'admin',
  password: 'ZYkrux3aezztgWxxUyG4',
  database: 'messaging_personal',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

module.exports = pool;
