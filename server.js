// dotenv FIRST: config/db.js and route modules read env at require time.
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { getDBConnection } = require('./config/db');
const publicRoutes = require('./src/backend_routes/Public_server');
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

app.use('/api/dfresh', publicRoutes);

app.listen(PORT, () => {
  console.log(`dFresh API listening on http://localhost:${PORT}`);
});
