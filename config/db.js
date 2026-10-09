// One mysql2 pool per database name (Inside D pattern).
// Env is loaded here too, so scripts that require this file directly still get DB settings.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2');

const pools = {};

function getDBConnection(database) {
  if (!pools[database]) {
    pools[database] = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pools[database];
}

module.exports = { getDBConnection };
