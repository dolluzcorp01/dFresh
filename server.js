// dotenv FIRST: config/db.js and route modules read env at require time.
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { getDBConnection } = require('./config/db');
const publicRoutes = require('./src/backend_routes/Public_server');
const contentCache = require('./src/backend_routes/content-cache');
const { version } = require('./package.json');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 4012;

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
app.use(express.json({ limit: '1mb' }));

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
});
server.on('error', failListen);
