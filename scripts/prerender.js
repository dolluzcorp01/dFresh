// `npm run build` step 2 (postbuild): pre-renders every public page per language into static HTML.
// 1. Compiles src/ssr.js into a Node bundle, build-ssr/ssr.js, with the SAME REACT_APP_* values and
//    NODE_ENV=production as the browser build (react-scripts' own env helper), CSS imports dropped.
// 2. Renders every active language x home / products (+ each ?cat=) / privacy / terms with the content the API
//    serves now (Public_server content cache = the DB) into build-ssr/pages.json:
//    { "<path>": { hash, html } }. hash = sha1 of the #dfresh-data JSON the page is served with (seo.js), so the
//    server only ever sends HTML that matches the data the browser hydrates with. When the content has changed
//    since the build (admin edit), seo.js renders that page again with build-ssr/ssr.js and keeps it in memory.
// build-ssr/ is not public (server.js serves build/ only) and not in git; deploy copies it next to build/.
// Without a database the bundle is still built and pages.json is empty: every page is then rendered on its
// first request.
require('dotenv').config({ quiet: true });

process.env.NODE_ENV = 'production';
process.env.BABEL_ENV = 'production';

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const getClientEnvironment = require('react-scripts/config/env');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build-ssr');

function bundle() {
  const env = getClientEnvironment('');
  const config = {
    mode: 'production',
    target: 'node',
    context: ROOT,
    entry: path.join(ROOT, 'src/ssr.js'),
    output: { path: OUT, filename: 'ssr.js', library: { type: 'commonjs2' }, clean: true },
    // react, react-dom, react-router-dom ... come from node_modules at run time (one React for the server)
    externals: [({ request }, cb) => (/^[a-z@]/i.test(request) && !path.isAbsolute(request) ? cb(null, `commonjs ${request}`) : cb())],
    module: {
      rules: [
        { test: /\.css$/i, use: path.join(__dirname, 'ssr-null-loader.js') },
        {
          test: /\.jsx?$/,
          include: path.join(ROOT, 'src'),
          loader: require.resolve('babel-loader'),
          options: {
            babelrc: false,
            configFile: false,
            presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]],
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin(env.stringified),
      new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    optimization: { minimize: false },
    devtool: false,
    performance: { hints: false },
  };
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
      return resolve();
    });
  });
}

async function renderAll() {
  const { content } = require('../src/backend_routes/Public_server');
  const seo = require('../src/backend_routes/seo');
  const { renderPage } = require(path.join(OUT, 'ssr.js'));
  const langs = (await content.loadLanguages()).data;
  const pages = {};
  for (const l of langs.languages) {
    const boot = (await content.getBootstrap(l.code)).data;
    const targets = [['', ''], ['products', ''], ...(boot.categories || []).map((c) => ['products', c.key]), ['privacy', ''], ['terms', '']];
    for (const [page, cat] of targets) {
      const url = seo.pagePath(l.code, page, cat);
      pages[url] = { hash: seo.dataHash(langs, boot), html: await renderPage(url, langs, boot) };
    }
  }
  return pages;
}

async function main() {
  const t0 = Date.now();
  await bundle();
  console.log(`prerender: build-ssr/ssr.js built (${Date.now() - t0} ms)`);
  let pages = {};
  try {
    pages = await renderAll();
  } catch (err) {
    console.warn(`prerender: pages NOT pre-rendered (${err.code || err.message}); the server renders each page on its first request.`);
  }
  fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(pages));
  const n = Object.keys(pages).length;
  const kb = Math.round(Object.values(pages).reduce((s, p) => s + p.html.length, 0) / 1024);
  console.log(`prerender: ${n} page(s) written to build-ssr/pages.json (${kb} KB of HTML, ${Date.now() - t0} ms)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('prerender failed:', err.message);
  process.exit(1);
});
