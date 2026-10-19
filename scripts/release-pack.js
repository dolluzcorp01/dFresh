// `npm run release:pack` (Pavithran's PC, deploy/DEPLOY.md): builds the LIVE release and packs ONLY what the droplet
// needs into release/dfresh-<date>-<commit>.tar.gz + .sha256. The droplet never builds (1 GB RAM) and never gets
// dev dependencies, source maps, caches or the React sources.
// 1. Refuses unless the working tree is the committed HEAD (what is packed = what is in git), except
//    src/i18n/fallbackText.json, which the build itself rewrites from the DB.
// 2. `npm run build` with REACT_APP_API='' (same origin: the local .env points at localhost) and
//    GENERATE_SOURCEMAP=false; prebuild / postbuild read the LOCAL database (fallback texts, pre-rendered pages:
//    on the server a page whose content differs is simply rendered again on its first request).
// 3. Checks the build: no source maps, no localhost URL, pre-rendered pages present.
// 4. Server files straight from git (`git archive HEAD`: Linux line endings, file modes kept, nothing untracked),
//    then build/, build-ssr/ and RELEASE.txt appended, gzipped; SHA-256 next to it.
// Usage: npm run release:pack   (Git Bash only: `npm run release:pack -- --skip-build` packs the existing build of the
// same commit; PowerShell's npm drops the `--`, so there it always builds)
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release');
const ALLOWED_DIRTY = ['src/i18n/fallbackText.json'];

// What the server needs from git (server.js's require tree, data it reads at run time, first-install media sources)
const FROM_GIT = [
  'server.js', 'package.json', 'package-lock.json', '.env.example',
  'config', 'src/backend_routes', 'src/shared', // API, SEO, mail, workers (src/shared is also used by the API)
  'fonts/source', 'fonts/scripts.json', // script fonts, subset by the server at run time
  'database', // schema, seed, migrations
  'deploy', // DEPLOY.md, nginx, pm2, backup
  'maintenance', // nginx maintenance page
  'assets/products', 'assets/banners', 'assets/logo/web', // media sources: `npm run media:sync` on the first install
  'scripts/media-sync.js', 'scripts/media-build.js',
];
const BUILT = ['build', 'build-ssr'];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const fail = (msg) => { console.error(`release:pack refused: ${msg}`); process.exit(1); };
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function walk(dir, list = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, list); else list.push(p);
  }
  return list;
}

function main() {
  const skipBuild = process.argv.includes('--skip-build');
  // 1. clean tree
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/"/g, ''))
    .filter((f) => !ALLOWED_DIRTY.includes(f));
  if (dirty.length) fail(`commit or stash these first (the archive must equal a commit):\n  ${dirty.join('\n  ')}`);
  const sha = git('rev-parse', '--short=8', 'HEAD');
  const subject = git('log', '-1', '--format=%s');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') console.warn(`note: packing branch ${branch}, not main`);

  // 2. build
  if (!skipBuild) {
    console.log(`building ${sha} (REACT_APP_API empty, no source maps) ...`);
    const r = spawnSync('npm', ['run', 'build'], {
      cwd: ROOT, stdio: 'inherit', shell: true,
      env: { ...process.env, REACT_APP_API: '', GENERATE_SOURCEMAP: 'false', CI: 'true' },
    });
    if (r.status !== 0) fail('the build failed (see above)');
  }

  // 3. check the build
  const buildFiles = walk(path.join(ROOT, 'build'));
  const maps = buildFiles.filter((f) => f.endsWith('.map'));
  if (maps.length) fail(`source maps in build/ (${maps.length}); run without --skip-build`);
  const local = buildFiles.filter((f) => /\.(js|html|css)$/.test(f) && /localhost:\d{4}/.test(fs.readFileSync(f, 'utf8')));
  if (local.length) fail(`a localhost URL is baked into ${local.map((f) => path.relative(ROOT, f)).join(', ')}`);
  const pagesFile = path.join(ROOT, 'build-ssr', 'pages.json');
  if (!fs.existsSync(path.join(ROOT, 'build-ssr', 'ssr.js')) || !fs.existsSync(pagesFile)) fail('build-ssr/ is incomplete');
  const pages = Object.keys(JSON.parse(fs.readFileSync(pagesFile, 'utf8'))).length;
  if (!pages) fail('no pre-rendered pages (was the local database running during the build?)');

  // 4. archive
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const name = `dfresh-${stamp}-${sha}`;
  const tarFile = path.join(OUT, `${name}.tar`);
  const releaseTxt = path.join(ROOT, 'RELEASE.txt'); // archive root (not build/: that folder is public)
  // git archive: LF line endings (autocrlf off), modes from git (backup.sh stays executable), tracked files only
  execFileSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', tarFile, 'HEAD', '--', ...FROM_GIT], { cwd: ROOT });
  fs.writeFileSync(releaseTxt, [
    `release  ${name}`, `commit   ${git('rev-parse', 'HEAD')}`, `subject  ${subject}`,
    `built    ${new Date().toISOString()} on ${process.platform}, node ${process.version}`, `pages    ${pages} pre-rendered`, '',
  ].join('\n'));
  // build/ and build-ssr/ appended (relative paths, run from the repo root so no drive letter reaches tar)
  const add = spawnSync('tar', ['-rf', path.relative(ROOT, tarFile).split(path.sep).join('/'), ...BUILT, 'RELEASE.txt'], { cwd: ROOT, stdio: 'inherit' });
  fs.unlinkSync(releaseTxt);
  if (add.status !== 0) fail('tar could not add build/ and build-ssr/');
  const gz = `${tarFile}.gz`;
  fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(tarFile), { level: 9 }));
  const unpacked = fs.statSync(tarFile).size;
  fs.unlinkSync(tarFile);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(gz)).digest('hex');
  fs.writeFileSync(`${gz}.sha256`, `${hash}  ${path.basename(gz)}\n`); // `sha256sum -c` format, LF

  const listing = spawnSync('tar', ['-tzf', path.relative(ROOT, gz).split(path.sep).join('/')], { cwd: ROOT, encoding: 'utf8' });
  // Windows tar.exe ends lines with CRLF, GNU tar with LF; directory entries end with '/'
  const entries = listing.stdout.split(/\r?\n/).filter((l) => l && !l.endsWith('/'));
  // never in a release: top-level secrets / data / dev folders, React sources, source maps (build/static/media is fine)
  const bad = entries.filter((e) => /^(\.env|node_modules|private|media|docs|tests|visual-output)(\/|$)|^src\/(?!backend_routes\/|shared\/)|\.map$/.test(e));
  const missing = ['server.js', 'build/index.html', 'build-ssr/ssr.js', 'RELEASE.txt'].filter((f) => !entries.includes(f));
  if (listing.status !== 0 || bad.length || missing.length) {
    fs.rmSync(gz, { force: true });
    fs.rmSync(`${gz}.sha256`, { force: true }); // a refused archive is never left behind to be uploaded by mistake
    if (listing.status !== 0) fail('tar could not list the archive');
    if (bad.length) fail(`unexpected files in the archive: ${bad.slice(0, 5).join(', ')}`);
    fail(`missing in the archive: ${missing.join(', ')}`);
  }

  console.log(`
release   ${path.relative(ROOT, gz)}
sha256    ${hash}
size      ${mb(fs.statSync(gz).size)} packed, ${mb(unpacked)} unpacked, ${entries.length} files, ${pages} pre-rendered pages
commit    ${sha}  ${subject}

Upload (PowerShell, from the repo folder):
  scp release/${path.basename(gz)} release/${path.basename(gz)}.sha256 <user>@64.227.135.222:/var/www/dfresh-upload/
Then on the server: deploy/DEPLOY.md, "Update".`);
}

main();
