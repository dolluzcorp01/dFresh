// In-memory cache for public content (bootstrap per language, languages list, legal pages).
// Entries are built once and kept until bust(), which every admin write calls, or until they are
// older than TTL_MS, so DB changes made outside the admin (SQL client, seed edits) still show up
// without a restart. bust() also bumps contentVersion so clients can tell that content changed;
// a TTL rebuild does not (the ETag changes when the body does).
// Each entry stores the serialised JSON body and a strong ETag (hash of that body), so a 304 check
// costs nothing and the ETag survives a server restart when the content did not change.

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;

let contentVersion = 1;
// key -> { promise: Promise<{ data, body, etag }>, builtAt: ms or null while building }; treat data as read-only
const entries = new Map();

function getContentVersion() {
  return contentVersion;
}

function serialise(data) {
  const body = JSON.stringify({ success: true, data });
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
  return { data, body, etag };
}

/**
 * Returns the cached entry for key, building it with builder() on a miss or when it is older than TTL_MS.
 * Concurrent misses share one build. A failed build is not cached; when it was replacing an expired
 * entry, that entry is served (and kept, so the next request retries), otherwise the caller gets the rejection.
 * builder() returns the response `data` object.
 */
function getOrBuild(key, builder) {
  const current = entries.get(key);
  if (current && (current.builtAt === null || Date.now() - current.builtAt < TTL_MS)) return current.promise;

  const versionAtStart = contentVersion;
  const entry = { builtAt: null };
  entry.promise = Promise.resolve()
    .then(builder)
    .then(serialise)
    .then(
      (result) => {
        // bust() during the build: the result may already be stale, so hand it out once but do not keep it.
        if (entries.get(key) === entry) {
          if (versionAtStart === contentVersion) entry.builtAt = Date.now();
          else entries.delete(key);
        }
        return result;
      },
      (err) => {
        if (entries.get(key) !== entry) throw err;
        if (current && versionAtStart === contentVersion) {
          console.error(`content rebuild failed for ${key}, serving the expired copy:`, err.code || err.message);
          entries.set(key, current);
          return current.promise;
        }
        entries.delete(key);
        throw err;
      }
    );
  entries.set(key, entry);
  return entry.promise;
}

function bust() {
  contentVersion += 1;
  entries.clear();
}

module.exports = { getOrBuild, bust, getContentVersion, TTL_MS };
