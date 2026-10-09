// LOCAL DEV ONLY: drop + create the dfresh database, load schema + seed + database/migrations/*.sql.
// Connects with DB_ADMIN_USER / DB_ADMIN_PASSWORD when both are set (a limited app user cannot DROP / CREATE
// databases), else with DB_USER / DB_PASSWORD.
// --create-app-user also (re)creates the limited app user named by APP_DB_USER / APP_DB_PASSWORD
// (default DB_USER / DB_PASSWORD when an admin login is set) with the grants from database/README.md.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SAFE_IDENT = /^[A-Za-z0-9_]{1,32}$/;
// The SQL files hard-code `USE dfresh`, so any other DB_NAME would silently reset the wrong database.
const DB_NAME = 'dfresh';
const DADMIN_TABLES = [
  ['employee', 'SELECT'],
  ['login_session_revoke', 'SELECT'],
  ['login_otp', 'SELECT, INSERT, UPDATE, DELETE'],
];

function fail(msg) {
  console.error(`db:reset refused: ${msg}`);
  process.exit(1);
}

async function main() {
  if (process.env.NODE_ENV === 'production') fail('NODE_ENV=production');
  if ((process.env.DB_NAME || DB_NAME) !== DB_NAME) fail(`DB_NAME must be "${DB_NAME}" (the SQL files use it)`);
  const host = process.env.DB_HOST || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) fail(`DB_HOST is "${host}", not a local server`);
  // Both keys must be present: a leftover DB_ADMIN_USER alone must not mean 'admin with no password'.
  const useAdmin = Boolean(process.env.DB_ADMIN_USER) && process.env.DB_ADMIN_PASSWORD !== undefined;
  const loginUser = useAdmin ? process.env.DB_ADMIN_USER : process.env.DB_USER;
  const loginPass = useAdmin ? process.env.DB_ADMIN_PASSWORD : process.env.DB_PASSWORD;
  if (!loginUser) fail('neither DB_ADMIN_USER nor DB_USER is set in .env');
  console.log(`login: ${useAdmin ? 'DB_ADMIN_USER' : 'DB_USER'}`);

  const createAppUser = process.argv.includes('--create-app-user');
  const appUser = process.env.APP_DB_USER || (useAdmin ? process.env.DB_USER : '');
  const appPass = process.env.APP_DB_PASSWORD || (useAdmin ? process.env.DB_PASSWORD : '');
  const dadminName = process.env.DADMIN_DB_NAME || 'dadmin';
  if (createAppUser) {
    if (!SAFE_IDENT.test(appUser || '')) fail('app user name missing (APP_DB_USER) or has unsafe characters');
    if (!SAFE_IDENT.test(dadminName)) fail('DADMIN_DB_NAME has unsafe characters');
    if (appUser === loginUser) fail('the app user must differ from the login used for the reset');
    if (!appPass || appPass.length < 16) fail('app user password must be at least 16 characters');
  }

  const conn = await mysql.createConnection({
    host,
    user: loginUser,
    password: loginPass || '',
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  try {
    const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
    console.log(`server: MySQL ${v}`);

    await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    // Schema + seed, then every migration in name order (YYYYMMDD_name.sql), as production gets them.
    const dbDir = path.join(__dirname, '..', 'database');
    const migrations = fs.readdirSync(path.join(dbDir, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => `migrations/${f}`);
    for (const file of ['01_schema.sql', '02_seed.sql', ...migrations]) {
      await conn.query(fs.readFileSync(path.join(dbDir, file), 'utf8'));
      console.log(`loaded: database/${file}`);
    }

    if (createAppUser) await createLimitedUser(conn, appUser, appPass, dadminName);
    else console.log('app user: SKIPPED (pass --create-app-user to create it)');

    const [[c]] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM ${DB_NAME}.products WHERE variant_of IS NULL)     AS products,
         (SELECT COUNT(*) FROM ${DB_NAME}.products WHERE variant_of IS NOT NULL) AS variants,
         (SELECT COUNT(*) FROM ${DB_NAME}.product_images)                        AS images,
         (SELECT COUNT(*) FROM ${DB_NAME}.languages)                             AS languages,
         (SELECT COUNT(*) FROM ${DB_NAME}.ui_text_keys)                          AS ui_keys,
         (SELECT COUNT(*) FROM ${DB_NAME}.banners)                               AS banners,
         (SELECT COUNT(*) FROM ${DB_NAME}.admin_users)                           AS admin_users`
    );
    console.log('counts:', JSON.stringify(c));
  } finally {
    await conn.end();
  }
}

async function createLimitedUser(conn, appUser, appPass, dadminName) {
  // Identifiers cannot be bound as ?, so they are whitelisted by SAFE_IDENT above; the password is bound.
  const account = `'${appUser}'@'localhost'`;
  await conn.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ?`, [appPass]);
  await conn.query(`ALTER USER ${account} IDENTIFIED BY ?`, [appPass]);
  await conn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO ${account}`);
  console.log(`app user: ${appUser}@localhost granted SELECT, INSERT, UPDATE, DELETE on ${DB_NAME}.*`);

  const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [dadminName]);
  if (dbs.length === 0) {
    console.log(`dadmin grants: SKIPPED (database "${dadminName}" not found on this server)`);
  } else {
    for (const [table, privs] of DADMIN_TABLES) {
      const [t] = await conn.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [dadminName, table]
      );
      if (t.length === 0) {
        console.log(`dadmin grants: SKIPPED ${dadminName}.${table} (table not found)`);
        continue;
      }
      await conn.query(`GRANT ${privs} ON \`${dadminName}\`.\`${table}\` TO ${account}`);
      console.log(`dadmin grants: ${privs} on ${dadminName}.${table}`);
    }
  }
}

main().catch((err) => {
  console.error('db:reset failed:', err.code || '', err.sqlMessage || err.message);
  process.exit(1);
});
