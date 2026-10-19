// One mysql2 pool per database name (Inside D pattern).
// Env is loaded here too, so scripts that require this file directly still get DB settings.
// Times: every dFresh DATETIME is UTC. Each connection sets its MySQL session to UTC (NOW(), CURRENT_TIMESTAMP write
// UTC) and mysql2 reads / writes DATETIME as UTC (timezone 'Z'), whatever zone the server, the PC or MySQL's default
// is in. Display converts to Asia/Kolkata (admin fmtDate, staff e-mails, sheet, Excel, CSV). dAdmin's own DATETIMEs
// are written in the server's default zone: auth.js converts the one it reads (login_session_revoke.revoked_at).
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
      timezone: 'Z',
    });
    // runs before any query of a new connection (mysql2 queues commands per connection in order)
    pools[database].on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  }
  return pools[database];
}

module.exports = { getDBConnection };
