// node scripts/visual-parity/diff.js <phase> before [after]
// Markdown table of every measured value where ours differs from the preview by more than 4px or 5%
// (sub-pixel rounding, under 1 unit, is ignored). With [after]: before/after columns + what is still open.
const fs = require('fs');
const path = require('path');
const [phase, bl, al] = process.argv.slice(2);
const DIR = path.resolve('visual-output', phase);
const B = JSON.parse(fs.readFileSync(path.join(DIR, `m-${bl}.json`)));
const A = al ? JSON.parse(fs.readFileSync(path.join(DIR, `m-${al}.json`))) : null;
const bad = (p, o) => {
  if (p == null && o == null) return false;
  if (p == null || o == null) return true;
  const d = Math.abs(p - o);
  return d >= 1 && (d > 4 || d / Math.max(Math.abs(p), 1) > 0.05);
};
const fmt = (v) => (v === undefined ? '-' : v === null ? 'n/a' : typeof v === 'object' ? 'hidden' : Math.round(v * 10) / 10);
const rows = [];
let openB = 0, openA = 0;
for (const w of Object.keys(B)) {
  const P = B[w].preview, O = B[w].ours, OA = A && A[w].ours, PA = A && A[w].preview;
  rows.push(`| ${w} | page | scrollWidth | ${P.__doc.scrollW} | ${O.__doc.scrollW} |${A ? ` ${OA.__doc.scrollW} |` : ''}`);
  for (const sec of Object.keys(P)) {
    if (sec === '__doc') continue;
    for (const name of Object.keys(P[sec] || {})) {
      const p = P[sec][name], o = O[sec] && O[sec][name];
      const pa = PA && PA[sec] && PA[sec][name], oa = OA && OA[sec] && OA[sec][name];
      const ph = !p || p.hidden, oh = !o || o.hidden;
      if (ph || oh) {
        if (ph !== oh) { openB++; rows.push(`| ${w} | ${sec} | ${name} | ${p ? (p.hidden ? 'hidden' : 'shown') : 'missing'} | ${o ? (o.hidden ? 'hidden' : 'shown') : 'missing'} |${A ? ` ${oa ? (oa.hidden ? 'hidden' : 'shown') : 'missing'} |` : ''}`); if (A && (!pa || !!pa.hidden) !== (!oa || !!oa.hidden)) openA++; }
        continue;
      }
      for (const k of Object.keys(p)) {
        if (!bad(p[k], o[k])) continue;
        openB++;
        let after = '';
        if (A) { const v = oa && !oa.hidden ? oa[k] : undefined; const pv = pa && !pa.hidden ? pa[k] : p[k]; after = ` ${fmt(v)}${bad(pv, v) ? ' (still off)' : ''} |`; if (bad(pv, v)) openA++; }
        rows.push(`| ${w} | ${sec} | ${name}.${k} | ${fmt(p[k])} | ${fmt(o[k])} |${after}`);
      }
    }
  }
}
console.log(`| vp | section | element.property | preview | ours${A ? ' before | ours after' : ''} |`);
console.log(`|---|---|---|---|---|${A ? '---|' : ''}`);
console.log(rows.join('\n'));
console.log(`\ndifferences: ${openB}${A ? `, still open after: ${openA}` : ''}`);
