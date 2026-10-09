// LOCAL DEV ONLY: clears the running API's content cache (POST /api/dfresh/dev/cache-bust), so a change
// made directly in the DB shows up now instead of after the cache TTL. The endpoint does not exist in production.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('cache:bust refused: NODE_ENV=production');
  process.exit(1);
}

const url = `http://localhost:${process.env.PORT || 4012}/api/dfresh/dev/cache-bust`;

fetch(url, { method: 'POST' })
  .then(async (res) => {
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.success) throw new Error(`HTTP ${res.status}`);
    console.log(`cache busted, contentVersion is now ${json.data.contentVersion}`);
  })
  .catch((err) => {
    if (err.cause && err.cause.code === 'ECONNREFUSED') {
      console.log(`API not running on ${url} - nothing to bust (the cache starts empty on the next start)`);
      return;
    }
    console.error('cache:bust failed:', err.message);
    process.exit(1);
  });
