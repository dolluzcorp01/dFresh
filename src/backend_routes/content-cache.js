// In-memory cache for public content (bootstrap per language, languages list, legal pages).
// Entries are built once and kept until bust(), which every admin write calls. bust() also bumps
// contentVersion so clients can tell that content changed.
// Each entry stores the serialised JSON body and a strong ETag (hash of that body), so a 304 check
// costs nothing and the ETag survives a server restart when the content did not change.

const crypto = require('crypto');

let contentVersion = 1;
const entries = new Map(); // key -> Promise<{ data, body, etag }>; treat data as read-only

function getContentVersion() {
  return contentVersion;
}

/**
 * Returns the cached entry for key, building it with builder() on a miss.
 * Concurrent misses share one build. A failed build is not cached (the caller still gets the rejection).
 * builder() returns the response `data` object.
 */
function getOrBuild(key, builder) {
  if (!entries.has(key)) {
    const versionAtStart = contentVersion;
    const p = Promise.resolve()
      .then(builder)
      .then((data) => {
        const body = JSON.stringify({ success: true, data });
        const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
        return { data, body, etag };
      });
    entries.set(key, p);
    // Drop this entry (and only this one: a newer build may already sit under the key) when the
    // build failed, or when bust() ran during it so the result may already be stale.
    const drop = () => { if (entries.get(key) === p) entries.delete(key); };
    p.then(() => { if (versionAtStart !== contentVersion) drop(); }, drop);
  }
  return entries.get(key);
}

function bust() {
  contentVersion += 1;
  entries.clear();
}

module.exports = { getOrBuild, bust, getContentVersion };
