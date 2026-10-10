// Try it: the roll (spec B6), a port of the preview's "roll it out". Grab and spin the roll either way (one way
// lets paper out, the other winds it back), or pull the paper / the tab at its end. A flick keeps going and
// slows down naturally; the roll gets thinner as paper comes off; the paper runs along a shelf, drapes over the
// nose and piles up in soft folds on the floor, with perforations and the rl_* labels travelling with it.
// Tap = quick roll out / back. It unrolls once by itself when #play is first 35% visible (straight from the
// observer, like the preview, so it starts on the next frame).
// Physics steps at a fixed 60 Hz, so it runs exactly like the preview on any display. One rAF loop, only while
// on screen, tab visible and something moves. Reduced motion: no inertia, no sway, a tap jumps straight there.
import { useEffect, useId, useRef } from 'react';
import { useI18n } from '../i18n/useT';
import { burst } from '../utils/burst';
import { createLoop, watchActive } from '../utils/loop';
import { track } from '../utils/track';
import useReducedMotion from '../utils/useReducedMotion';

const LABEL_KEYS = ['rl_ply', 'rl_soft', 'rl_pulls', 'rl_perf', 'rl_tear', 'rl_fits'];
const R0 = 96; // roll radius in the 200x200 SVG, full
const RMIN = 52; // and empty
const STRIP_H = 72; // paper band height (preview: #play .urb .strip)
const SHEET = 130; // one sheet between perforations, px
const LABEL_MAX = 122; // widest label on a sheet, px
const STEP = 1 / 60;
const RINGS = [86, 74, 62, 50];

let rollTracked = false; // GA4 roll_play once per visit

// A label wider than a sheet (long translations) wraps onto two lines at the most balanced space;
// only a line that is still too wide is narrowed by fillText's maxWidth.
function fitLabel(cx, text) {
  if (cx.measureText(text).width <= LABEL_MAX) return [text];
  const words = text.split(' ');
  let best = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(cx.measureText(a).width, cx.measureText(b).width);
    if (w < bestW) {
      bestW = w;
      best = [a, b];
    }
  }
  return best;
}

const rnd = (k) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export default function RollToy() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  const urbRef = useRef(null);
  const rollRef = useRef(null);
  const spinRef = useRef(null);
  const cvRef = useRef(null);
  const tabRef = useRef(null);
  const labels = useRef([]);
  labels.current = LABEL_KEYS.map((k) => t(k));
  const api = useRef(null); // { unroll(), redraw() }
  const unrolledOnce = useRef(false); // survives a remount (reduced-motion change)

  useEffect(() => {
    const urb = urbRef.current;
    const rl = rollRef.current;
    const spin = spinRef.current;
    const cv = cvRef.current;
    const tab = tabRef.current;
    const tile = urb.closest('.tile');
    const cx = cv.getContext('2d');
    const circ = [...spin.querySelectorAll('circle')];
    const mark = spin.querySelector('rect');
    const RL = { len: 0, vel: 0, target: null, mode: null, moved: 0, lastDrag: 0, th: 0, thv: 0, dirty: true, ang: 0, lastL: null, active: false, acc: 0 };
    const G = {};
    let S = { pile: 0, hang: 0 };
    let ps = [];
    let font = '';

    const layout = () => {
      const ur = urb.getBoundingClientRect();
      const tr = tile.getBoundingClientRect();
      const Rs = rl.offsetWidth;
      const h = STRIP_H;
      const W = Math.max(Rs + 140, tr.right - 18 - ur.left);
      const H = Math.max(Rs + 60, tr.bottom - 12 - ur.top);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rb = h / 2 + 14;
      const x0 = Rs / 2;
      const yc = Rs - h / 2;
      const E = W - rb - h / 2 - 4;
      const floor = H - 2;
      const hangFull = Math.max(20, floor - (yc + rb));
      const step = h < 80 ? 9 : 11;
      const th = step * 1.95;
      const nL = Math.max(3, Math.floor((hangFull - 34) / step));
      const layers = [];
      for (let k = 0; k < nL; k += 1) {
        const w = Math.max(h + 20, (h + 128) - k * 7 + rnd(k) * 26);
        const right = W - 4 - rnd(k + 40) * 12 - (k % 2) * 9;
        layers.push({ w, right, rot: (rnd(k + 80) - 0.5) * 0.045, len: w * 1.1, perf: 0.25 + rnd(k + 9) * 0.5, seed: k, side: k % 2 ? 1 : -1 });
      }
      Object.assign(G, { W, H, Rs, h, rb, x0, yc, E, floor, hangFull, step, th, layers, run: Math.max(0, E - x0), bend: (Math.PI / 2) * rb, MINL: Rs * 0.5 + 46, font: h < 80 ? 12.5 : 15 });
      G.drape = G.run + G.bend + hangFull;
      G.max = G.drape + layers.reduce((a, l) => a + l.len, 0);
      if (!RL.len) RL.len = G.MINL;
      RL.len = Math.min(RL.len, G.max);
      RL.dirty = true;
    };

    // state derived from the paper length: hanging length, pile fill
    const state = (L) => {
      const g = G;
      let rem = L - g.drape;
      if (rem <= 0) return { pile: 0, full: 0, frac: 0, hang: Math.max(0, L - g.run - g.bend), end: L };
      let full = 0;
      while (full < g.layers.length && rem >= g.layers[full].len) {
        rem -= g.layers[full].len;
        full += 1;
      }
      const frac = full < g.layers.length ? rem / g.layers[full].len : 0;
      const top = g.floor - (full + frac) * g.step;
      const hang = Math.max(4, top - (g.yc + g.rb) + 6);
      return { pile: 1, full, frac, top, hang, end: g.run + g.bend + hang };
    };

    // point at arc length s along the paper: [x, y, angle]
    const pt = (s0) => {
      const g = G;
      let s = s0;
      if (s <= g.run) return [g.x0 + s, g.yc, 0];
      s -= g.run;
      if (s <= g.bend) {
        const f = s / g.rb;
        return [g.E + g.rb * Math.sin(f), g.yc + g.rb - g.rb * Math.cos(f), f];
      }
      const tt = s - g.bend;
      const hl = Math.max(1, S.hang);
      const u = Math.min(1, tt / hl);
      const A = Math.sin(RL.th) * hl * 0.38;
      if (S.pile) {
        const k = A * 0.45;
        return [g.E + g.rb + k * Math.sin(Math.PI * u), g.yc + g.rb + tt, Math.atan2(1, (k * Math.PI * Math.cos(Math.PI * u)) / hl)];
      }
      return [g.E + g.rb + A * u * u, g.yc + g.rb + tt, Math.atan2(1, (2 * A * u) / hl)];
    };

    const rOf = (L) => {
      const f = Math.max(0, Math.min(1, (L - G.MINL) / Math.max(1, G.max - G.MINL)));
      return Math.sqrt(RMIN * RMIN + (R0 * R0 - RMIN * RMIN) * (1 - f));
    };

    const fold = (x0, x1, yb, tk, rot, l) => {
      const w = x1 - x0;
      const rR = (tk / 2) * (l.side > 0 ? 1.22 : 0.92);
      const rL = (tk / 2) * (l.side > 0 ? 0.92 : 1.22);
      const c = (x0 + x1) / 2;
      cx.save();
      cx.translate(c, yb);
      cx.rotate(rot);
      cx.translate(-c, -yb);
      cx.beginPath();
      cx.moveTo(x0 + rL, yb);
      cx.lineTo(x1 - rR, yb);
      cx.arc(x1 - rR, yb - rR, rR, Math.PI / 2, -Math.PI / 2, true);
      const nb = Math.max(2, Math.round(w / 38));
      const ya = yb - 2 * rR;
      const yz = yb - 2 * rL;
      for (let i = 1; i <= nb; i += 1) {
        const xa = x1 - rR - ((w - rR - rL) * (i - 1)) / nb;
        const xb = x1 - rR - ((w - rR - rL) * i) / nb;
        const yy = ya + ((yz - ya) * i) / nb;
        const bump = (rnd(l.seed * 7 + i) - 0.5) * 5;
        cx.quadraticCurveTo((xa + xb) / 2, yy - 2 + bump, xb, yy);
      }
      cx.arc(x0 + rL, yb - rL, rL, -Math.PI / 2, Math.PI / 2, true);
      cx.closePath();
      const gr = cx.createLinearGradient(0, yb - tk * 1.25, 0, yb);
      gr.addColorStop(0, '#FFFEFA');
      gr.addColorStop(0.45, '#F4EEE1');
      gr.addColorStop(1, '#D3C8AD');
      cx.fillStyle = gr;
      cx.fill();
      cx.strokeStyle = 'rgba(80,60,20,.14)';
      cx.lineWidth = 1;
      cx.stroke();
      cx.strokeStyle = 'rgba(255,255,255,.75)';
      cx.lineWidth = 1.2;
      cx.beginPath();
      cx.moveTo(x0 + rL + 6, yb - 2 * rL + 3);
      cx.lineTo(x1 - rR - 6, yb - 2 * rR + 3);
      cx.stroke();
      cx.restore();
    };

    const draw = () => {
      const g = G;
      const L = Math.max(g.MINL, Math.min(g.max, RL.len));
      S = state(L);
      cx.clearRect(0, 0, g.W, g.H);
      // the roll: thinner as paper leaves, sits on the shelf, turns with the paper
      if (RL.lastL === null) RL.lastL = L;
      const r = rOf(L);
      const sc = g.Rs / 200;
      RL.ang -= (L - RL.lastL) / (r * sc);
      RL.lastL = L;
      circ[0].setAttribute('r', r.toFixed(2));
      for (let i = 1; i <= 4; i += 1) circ[i].style.display = RINGS[i - 1] < r - 3 ? '' : 'none';
      mark.setAttribute('y', (100 - r + 3).toFixed(2));
      mark.setAttribute('height', Math.max(6, Math.min(30, r - 40)).toFixed(2));
      spin.style.transform = `rotate(${RL.ang}rad)`;
      rl.style.transform = `translateY(${((R0 - r) * sc).toFixed(2)}px)`;
      // shelf with a rounded nose
      const sy = g.Rs;
      const sr = g.rb - g.h / 2;
      cx.fillStyle = '#26262A';
      cx.beginPath();
      cx.moveTo(g.Rs * 0.08, sy);
      cx.lineTo(g.E, sy);
      cx.arc(g.E, sy + sr, sr, -Math.PI / 2, Math.PI / 2);
      cx.lineTo(g.Rs * 0.08, sy + 2 * sr);
      cx.closePath();
      cx.fill();
      cx.fillStyle = 'rgba(255,255,255,.07)';
      cx.fillRect(g.Rs * 0.08, sy, g.E - g.Rs * 0.08, 2);
      // floor shadow under the pile
      if (S.pile) {
        const pw = g.layers[0].w;
        const pc = g.layers[0].right - pw / 2;
        const gr = cx.createRadialGradient(pc, g.floor, 4, pc, g.floor, pw * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,.55)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        cx.save();
        cx.scale(1, 0.18);
        cx.fillStyle = gr;
        cx.fillRect(pc - pw, (g.floor - 30) / 0.18, pw * 2, 60 / 0.18);
        cx.restore();
      }
      // the paper band
      ps = [];
      const end = S.end;
      for (let s = 0; s < end; s += 4) ps.push(pt(s));
      ps.push(pt(end));
      const n = ps.length - 1;
      const path = (a, b) => {
        cx.beginPath();
        cx.moveTo(ps[a][0], ps[a][1]);
        for (let i = a + 1; i <= b; i += 1) cx.lineTo(ps[i][0], ps[i][1]);
      };
      cx.lineJoin = 'round';
      cx.lineCap = 'butt';
      cx.save();
      cx.shadowColor = 'rgba(0,0,0,.42)';
      cx.shadowBlur = 24;
      cx.shadowOffsetY = 12;
      path(0, n);
      cx.lineWidth = g.h;
      cx.strokeStyle = '#ECE5D2';
      cx.stroke();
      cx.restore();
      for (let i = 1; i < 10; i += 1) {
        const f = i / 10;
        const k = Math.sin((f * Math.PI) / 2);
        path(0, n);
        cx.lineWidth = g.h * (1 - f * 0.92);
        cx.strokeStyle = `rgb(${(236 + 19 * k) | 0},${(229 + 26 * k) | 0},${(210 + 45 * k) | 0})`;
        cx.stroke();
      }
      if (end > g.run) {
        const a = Math.floor(g.run / 4);
        const b = Math.min(n, Math.ceil((g.run + g.bend) / 4));
        if (b > a) {
          path(a, b);
          cx.lineWidth = g.h;
          cx.strokeStyle = 'rgba(120,96,50,.10)';
          cx.stroke();
        }
      }
      // sheets: perforations and labels travel with the paper (counted from the free end)
      cx.setLineDash([3, 4]);
      cx.lineWidth = 1.4;
      cx.strokeStyle = 'rgba(18,18,20,.22)';
      for (let k = Math.max(1, Math.ceil((L - end) / SHEET)); ; k += 1) {
        const s = L - k * SHEET;
        if (s < g.Rs * 0.5) break;
        if (s > end) continue;
        const [x, y, a] = pt(s);
        const nx = (-Math.sin(a) * g.h) / 2;
        const ny = (Math.cos(a) * g.h) / 2;
        cx.beginPath();
        cx.moveTo(x - nx, y - ny);
        cx.lineTo(x + nx, y + ny);
        cx.stroke();
      }
      cx.setLineDash([]);
      cx.font = `800 ${g.font}px ${font}`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillStyle = '#121214';
      const lab = labels.current;
      for (let k = Math.max(0, Math.floor((L - end) / SHEET)); ; k += 1) {
        const s = L - SHEET / 2 - k * SHEET;
        const v = s - g.Rs * 0.5 - 24;
        if (v <= 0) break;
        if (s > end - 20) continue;
        const [x, y, a] = pt(s);
        cx.save();
        cx.globalAlpha = Math.min(1, v / 40);
        cx.translate(x, y);
        cx.rotate(a);
        const lines = fitLabel(cx, lab[k % lab.length]);
        const lh = g.font * 1.25;
        lines.forEach((ln, j) => cx.fillText(ln, 0, (j - (lines.length - 1) / 2) * lh, LABEL_MAX));
        cx.restore();
      }
      // the heap: folded layers, bottom up; the top one is being laid down
      if (S.pile) {
        const cnt = S.full + (S.frac > 0 ? 1 : 0);
        for (let k = 0; k < cnt; k += 1) {
          const l = g.layers[k];
          const f = k < S.full ? 1 : S.frac;
          const w = g.h + (l.w - g.h) * f;
          const x1 = l.right;
          const x0 = x1 - w;
          const yb = g.floor - k * g.step;
          if (k > 0) {
            const sg = cx.createLinearGradient(0, yb - 2, 0, yb + 7);
            sg.addColorStop(0, 'rgba(40,30,10,.28)');
            sg.addColorStop(1, 'rgba(40,30,10,0)');
            cx.fillStyle = sg;
            cx.fillRect(x0 + 6, yb - 2, w - 12, 9);
          }
          fold(x0, x1, yb, g.th, l.rot * f, l);
          if (w > g.h + 30) {
            const px = x0 + w * l.perf;
            cx.setLineDash([2, 3]);
            cx.strokeStyle = 'rgba(18,18,20,.15)';
            cx.lineWidth = 1;
            cx.beginPath();
            cx.moveTo(px, yb - g.th + 5);
            cx.lineTo(px, yb - 4);
            cx.stroke();
            cx.setLineDash([]);
          }
        }
      }
      // the pull tab at the free end, only while the end is in the air
      if (!S.pile) {
        const [ex, ey, ea] = pt(L);
        tab.style.left = `${ex - 14}px`;
        tab.style.top = `${ey - 22}px`;
        tab.style.bottom = 'auto';
        tab.style.transform = `rotate(${ea}rad)`;
        tab.style.opacity = '1';
        tab.style.pointerEvents = '';
      } else {
        tab.style.opacity = '0';
        tab.style.pointerEvents = 'none';
      }
    };

    let lx = 0;
    let ly = 0;
    let la = 0;
    let lt = 0;

    // one 60 Hz physics step (the preview's per-frame tick)
    const physics = (now) => {
      const g = G;
      if (RL.mode === null) {
        if (RL.target !== null) {
          RL.vel += (RL.target - RL.len) * 0.04;
          RL.vel *= 0.84;
          RL.vel = Math.max(-46, Math.min(46, RL.vel));
          if (Math.abs(RL.target - RL.len) < 0.5 && Math.abs(RL.vel) < 0.04) {
            RL.len = RL.target;
            RL.target = null;
            RL.vel = 0;
          }
        } else {
          RL.vel *= 0.965;
          if (Math.abs(RL.vel) < 0.03) RL.vel = 0;
        }
        RL.len += RL.vel;
        if (RL.target === null && (RL.len > g.max || RL.len < g.MINL)) {
          RL.target = RL.len > g.max ? g.max : g.MINL;
          RL.vel *= 0.35;
        }
      } else if (now - lt > 60) RL.vel *= 0.8;
      // the hanging paper sways with the speed (a damped spring), none with reduced motion
      if (!reduced && RL.len - g.run - g.bend > 0) {
        const tt = Math.max(-0.32, Math.min(0.32, RL.vel * 0.02));
        RL.thv += (tt - RL.th) * 0.05;
        RL.thv *= 0.92;
        RL.th += RL.thv;
      } else {
        RL.th *= 0.8;
        RL.thv = 0;
      }
    };
    const busy = () => RL.vel || RL.target !== null || RL.mode || Math.abs(RL.thv) > 1e-4 || Math.abs(RL.th) > 1e-3;

    const loop = createLoop('roll', (dt, now) => {
      RL.acc = Math.min(RL.acc + dt, STEP * 4);
      while (RL.acc >= STEP) {
        physics(now);
        RL.acc -= STEP;
      }
      const moving = busy();
      if (moving || RL.dirty) {
        draw();
        RL.dirty = false;
      }
      return Boolean(moving);
    });
    const wake = () => {
      RL.dirty = true;
      if (!RL.active) {
        draw(); // off screen: still paint the new state once
        return;
      }
      if (!loop.isRunning()) RL.acc = STEP; // the first frame already takes a step, like the preview's per-frame tick
      loop.start();
    };

    const onPaper = (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      let md = 1e9;
      for (const p of ps) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d < md) md = d;
      }
      return Math.sqrt(md) < G.h / 2 + 8;
    };
    const angAt = (e) => {
      const b = rl.getBoundingClientRect();
      const c = [b.left + b.width / 2, b.top + b.height / 2];
      return [Math.atan2(e.clientY - c[1], e.clientX - c[0]), Math.hypot(e.clientY - c[1], e.clientX - c[0])];
    };
    const down = (mode) => (e) => {
      if (e.currentTarget === cv && !onPaper(e)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      RL.mode = mode;
      RL.moved = 0;
      RL.target = null;
      RL.vel = 0;
      lx = e.clientX;
      ly = e.clientY;
      la = angAt(e)[0];
      lt = performance.now();
      e.currentTarget.setPointerCapture(e.pointerId);
      urb.classList.add('grab');
      wake();
    };
    const move = (e) => {
      if (!RL.mode) {
        if (e.currentTarget === cv) cv.style.cursor = onPaper(e) ? 'grab' : '';
        return;
      }
      const now = performance.now();
      const dt = Math.max(8, now - lt);
      lt = now;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      let d;
      if (RL.mode === 'pull') {
        const a = pt(Math.min(S.end, Math.max(G.MINL, RL.len)))[2];
        d = dx * Math.cos(a) + dy * Math.sin(a);
      } else {
        const [a, dist] = angAt(e);
        let da = a - la;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        la = a;
        if (dist < 14) return;
        da = Math.max(-0.6, Math.min(0.6, da));
        d = -da * rOf(RL.len) * (rl.offsetWidth / 200);
      }
      if (RL.len + d < G.MINL || RL.len + d > G.max) d *= 0.3;
      RL.len += d;
      RL.moved += Math.abs(d);
      RL.vel = Math.max(-60, Math.min(60, (d * 16) / dt));
      RL.dirty = true;
    };
    const up = () => {
      if (!RL.mode) return;
      if (RL.moved > 6) RL.lastDrag = performance.now();
      RL.mode = null;
      urb.classList.remove('grab');
      if (reduced) RL.vel = 0; // no fling
      if (RL.len > G.max || RL.len < G.MINL) {
        RL.target = RL.len > G.max ? G.max : G.MINL;
        RL.vel *= 0.3;
        if (reduced) {
          RL.len = RL.target;
          RL.target = null;
        }
      }
      if (RL.moved > 6 && !rollTracked) {
        rollTracked = true;
        track('roll_play');
      }
      wake();
    };

    api.current = {
      // quick roll out (or back when it is already out); false right after a drag (that click is not a tap)
      unroll() {
        if (performance.now() - RL.lastDrag < 350) return false;
        const g = G;
        const show = Math.min(g.max, g.drape + g.layers[0].len + g.layers[1].len + g.layers[2].len * 0.5);
        const target = RL.len > g.MINL + 60 ? g.MINL : show;
        if (reduced) {
          RL.len = target;
          RL.target = null;
          RL.vel = 0;
        } else {
          RL.target = target;
          RL.vel = 0;
        }
        wake();
        return true;
      },
      redraw: wake,
    };

    const setFont = () => {
      // Saira for Latin, then the language's own script font (labels are translated)
      const lang = getComputedStyle(document.documentElement).getPropertyValue('--f-lang').trim();
      font = `Saira, ${lang ? `${lang}, ` : ''}sans-serif`;
    };
    setFont();

    const pull = down('pull');
    const spinDown = down('spin');
    [cv, tab].forEach((el) => {
      el.addEventListener('pointerdown', pull);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    rl.addEventListener('pointerdown', spinDown);
    rl.addEventListener('pointermove', move);
    rl.addEventListener('pointerup', up);
    rl.addEventListener('pointercancel', up);

    layout();
    draw();
    // resizing the canvas clears it: repaint in the same frame, never show an empty one
    const ro = new ResizeObserver(() => {
      layout();
      draw();
      RL.dirty = false;
      if (RL.active) loop.start();
    });
    ro.observe(tile);
    if (document.fonts) document.fonts.ready.then(() => { if (api.current) wake(); });
    const stopWatch = watchActive(urb, (active) => {
      RL.active = active;
      if (active) loop.start();
      else loop.stop();
    });
    let io = null;
    const autoUnroll = () => {
      if (unrolledOnce.current || !api.current) return;
      unrolledOnce.current = true;
      RL.active = true; // the section is on screen; the activity observer may report a frame later
      api.current.unroll();
    };
    if (!unrolledOnce.current) {
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { autoUnroll(); io.disconnect(); } }, { threshold: 0.35 });
        io.observe(urb.closest('section') || urb);
      } else autoUnroll();
    }

    return () => {
      loop.stop();
      stopWatch();
      if (io) io.disconnect();
      ro.disconnect();
      api.current = null;
      [cv, tab].forEach((el) => {
        el.removeEventListener('pointerdown', pull);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      });
      rl.removeEventListener('pointerdown', spinDown);
      rl.removeEventListener('pointermove', move);
      rl.removeEventListener('pointerup', up);
      rl.removeEventListener('pointercancel', up);
    };
  }, [reduced]);

  // new language: new labels (and maybe a new script font) on the paper
  const labelKey = labels.current.join('|');
  useEffect(() => {
    if (!api.current) return undefined;
    const id = requestAnimationFrame(() => api.current && api.current.redraw());
    return () => cancelAnimationFrame(id);
  }, [labelKey]);

  const onClick = () => {
    if (!api.current || !api.current.unroll()) return;
    if (!rollTracked) {
      rollTracked = true;
      track('roll_play');
    }
    const r = rollRef.current.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 8);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (api.current) api.current.unroll();
    }
  };

  return (
    <div className="urb" ref={urbRef}>
      <div className="roll" ref={rollRef} role="button" tabIndex={0} aria-label={t('roll_aria')} onClick={onClick} onKeyDown={onKey}>
        <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={`rg${gid}`} cx=".45" cy=".4">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#E9E2D0" />
            </radialGradient>
          </defs>
          <g className="spin" ref={spinRef}>
            <circle cx="100" cy="100" r={R0} fill={`url(#rg${gid})`} />
            {RINGS.map((r) => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#e3dbc6" />)}
            <circle cx="100" cy="100" r="34" fill="#C9A46A" />
            <circle cx="100" cy="100" r="22" fill="#121214" />
            <rect x="96" y="4" width="8" height="30" rx="3" fill="#E5BF24" />
          </g>
        </svg>
      </div>
      <canvas className="paper" ref={cvRef} aria-hidden="true" />
      <div className="tab" ref={tabRef} aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}
