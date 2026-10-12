// Worker thread for font-manager.js: subsetting is CPU work (harfbuzz in wasm, up to ~1 s for a large script),
// so it runs here and never blocks the API. Message in: { id, source (path), text } -> out: { id, woff2 } or
// { id, error }.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const subsetFont = require('subset-font');

parentPort.on('message', async ({ id, source, text }) => {
  try {
    const woff2 = await subsetFont(fs.readFileSync(source), text, { targetFormat: 'woff2' });
    parentPort.postMessage({ id, woff2 });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message || String(err) });
  }
});
