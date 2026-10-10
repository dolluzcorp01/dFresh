// dotenv FIRST: config/db.js and route modules read env at require time.
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { getDBConnection } = require('./config/db');
const { publicUrlProblems } = require('./config/urls');
const publicRoutes = require('./src/backend_routes/Public_server');
const leadRoutes = require('./src/backend_routes/Leads_server');
const brochureRoutes = require('./src/backend_routes/Brochure_server');
const adminLoginRoutes = require('./src/backend_routes/Admin_login_server');
const adminRoutes = require('./src/backend_routes/Admin_server');
const outboxWorker = require('./src/backend_routes/outbox-worker');
const contentCache = require('./src/backend_routes/content-cache');
const { version } = require('./package.json');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 4012;

// E-mails carry links built from these URLs: in production never start with a localhost or http one.
const urlProblems = publicUrlProblems();
if (urlProblems.length) {
  console.error(`dFresh API refuses to start: ${urlProblems.join('; ')}. Fix the server .env.`);
  process.exit(1);
}
// nginx on the same host forwards the visitor's address; req.ip (lead rate limit) reads it only from there.
app.set('trust proxy', 'loopback');

// Production: only the public site URL. Dev: any localhost port (CRA may pick 3001, 3002 ...).
const allowedOrigins = [process.env.PUBLIC_SITE_URL].filter(Boolean);
app.use(cors({
  credentials: true,
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (!isProd && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    return cb(null, false);
  },
}));
app.use(express.json({ limit: '100kb' }));

// Development only: one line per request (method, URL, status, time).
if (!isProd) {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}
app.use(cookieParser());

// Media file names never change content in place (new upload = new size build), so cache hard.
app.use('/media', express.static(path.join(__dirname, 'media'), {
  maxAge: '30d',
  immutable: true,
  fallthrough: false,
}));

app.get('/api/dfresh/health', async (req, res) => {
  try {
    const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
    const [[row]] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM products  WHERE is_active = 1 AND variant_of IS NULL)     AS products,
         (SELECT COUNT(*) FROM products  WHERE is_active = 1 AND variant_of IS NOT NULL) AS variants,
         (SELECT COUNT(*) FROM languages WHERE is_active = 1)                             AS languages`
    );
    res.json({
      success: true,
      data: {
        db: 'ok',
        counts: { products: Number(row.products), variants: Number(row.variants), languages: Number(row.languages) },
        version,
      },
    });
  } catch (err) {
    console.error('health check failed:', err.code || err.message);
    res.status(503).json({ success: false, message: 'Database unavailable' });
  }
});

// Development only, loopback only: `npm run cache:bust` clears the content cache after a hand edit in the DB
// (otherwise it shows up within the cache TTL). Not registered at all in production.
if (!isProd) {
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  app.post('/api/dfresh/dev/cache-bust', (req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress)) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    contentCache.bust();
    res.json({ success: true, data: { contentVersion: contentCache.getContentVersion() } });
  });
}

app.use('/api/dfresh', publicRoutes);
app.use('/api/dfresh', leadRoutes);
app.use('/api/dfresh', brochureRoutes);
// Sign-in first: /admin/login and /admin/login/verify must not hit the session check of Admin_server.
app.use('/api/dfresh', adminLoginRoutes);
app.use('/api/dfresh', adminRoutes);

// Malformed JSON, oversized body or any error a route did not handle: JSON, never a stack trace.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`${req.method} ${req.originalUrl} failed:`, err.code || err.message);
  res.status(status).json({ success: false, message: status === 413 ? 'Request too large' : status < 500 ? 'Bad request' : 'Server error' });
});

// Express 5 hands listen errors (e.g. EADDRINUSE) to this callback instead of throwing: never log success
// on failure, and exit non-zero so F5 / pm2 / the terminal show that it did not start.
function failListen(err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - stop the other dFresh API (or whatever holds the port) and try again.`);
  } else {
    console.error(`dFresh API could not start on port ${PORT}: ${err.code || err.message}`);
  }
  process.exit(1);
}

const server = app.listen(PORT, (err) => {
  if (err) return failListen(err);
  console.log(`dFresh API listening on http://localhost:${PORT}`);
  outboxWorker.start();
});
server.on('error', failListen);
