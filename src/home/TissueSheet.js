// Hero tissue sheet (spec B1), ported from the preview (docs/reference/dfresh-feel-gentle-tissue-pinch.html):
// a WebGL sheet of paper with the dFresh leaf-hand icon printed in the centre, embossed dots, gently
// billowing; pointer move / tap makes ripples, soft random auto-ripples, confetti on tap. 2D canvas without
// WebGL. The loop runs only while the sheet is on screen and the tab is visible. Lazy-loaded (its own chunk)
// by Hero, started after the page has loaded.
// "Pick it up anywhere": press and hold (>= 0.18 s) or move > 4 px on the sheet picks it up at that point
// (a quick tap only ripples). Then a Verlet cloth (33 x 25 nodes: structural, shear and weak bending links,
// gravity, air drag, 10 solver passes, soft floor and side limits) hangs from the pointer, with a duller back
// side and the logo faintly showing through, lit from both sides. On release gravity fades over 1.8 s, the pull
// back to the sheet eases in over 4.6 s and the last bit fades over 2 s (at rest after about 5 s); then the
// cloth is switched off and the original animated sheet draws again, so the idle cost is unchanged.
// Render mesh: 65 x 49 (the cloth sits on every 2nd vertex, as in the preview); phones keep their lighter
// 40 x 30 mesh (idle cost) with the same cloth spread over it.
// Reduced motion: one still frame, no ripples; the sheet can still be picked up, without flutter or swing, and
// is back at rest the moment it is let go.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { mediaUrl } from '../utils/api';
import { afterLoad, createLoop, watchActive } from '../utils/loop';
import { burst } from '../utils/burst';
import { track } from '../utils/track';
import useReducedMotion from '../utils/useReducedMotion';

const ICON = '/media/logo/dfresh-icon.webp'; // 512 x 333
const ICON_RATIO = 333 / 512;
const SX = 33; // cloth nodes across
const SY = 25; // cloth nodes down
const HOLD_MS = 180;
const MOVE_PX = 4;

const VS = 'attribute vec3 p;attribute vec2 uv;attribute float s;varying vec2 vU;varying float vS;void main(){vU=uv;vS=s;gl_Position=vec4(p,1.0);}';
// At rest: the original sheet shader (one-sided; same look and GPU cost as before the cloth).
const FS_REST = `precision mediump float;varying vec2 vU;varying float vS;uniform sampler2D tex;uniform float hasTex;uniform vec4 R;
void main(){
 float m=clamp((vS-.55)*3.0,0.0,1.0);
 vec3 col=mix(vec3(.915,.885,.83),vec3(1.0,.998,.99),m);
 vec2 g=vec2(vU.x*40.0,vU.y*29.0);vec2 q=fract(vec2(g.x+g.y,g.x-g.y)*.5)-.5;float dot_=smoothstep(.16,.07,length(q));
 col*=1.0-dot_*.045;
 float e=min(min(vU.x,1.0-vU.x),min(vU.y,1.0-vU.y));col*=mix(.9,1.0,smoothstep(0.0,.018,e));
 if(hasTex>.5){vec2 lu=(vU-R.xy)/R.zw;if(lu.x>0.0&&lu.x<1.0&&lu.y>0.0&&lu.y<1.0){vec4 t=texture2D(tex,lu);col=mix(col,t.rgb/max(t.a,.001)*(.94+.14*m),t.a*.95);}}
 gl_FragColor=vec4(col,1.0);
}`;
// Lifted (cloth active): two-sided, the back of the sheet slightly duller and the logo showing through faintly.
const FS = `precision mediump float;varying vec2 vU;varying float vS;uniform sampler2D tex;uniform float hasTex;uniform vec4 R;
void main(){
 bool front=!gl_FrontFacing;
 float m=clamp((vS-.55)*3.0,0.0,1.0);
 vec3 col=mix(vec3(.915,.885,.83),vec3(1.0,.998,.99),m);
 vec2 g=vec2(vU.x*40.0,vU.y*29.0);vec2 q=fract(vec2(g.x+g.y,g.x-g.y)*.5)-.5;float dot_=smoothstep(.16,.07,length(q));
 col*=1.0-dot_*(front?.045:.03);
 if(!front){col*=vec3(.975,.965,.945);}
 float e=min(min(vU.x,1.0-vU.x),min(vU.y,1.0-vU.y));col*=mix(.9,1.0,smoothstep(0.0,.018,e));
 if(hasTex>.5){vec2 lu=(vU-R.xy)/R.zw;if(lu.x>0.0&&lu.x<1.0&&lu.y>0.0&&lu.y<1.0){vec4 t=texture2D(tex,lu);vec3 lc=t.rgb/max(t.a,.001);
  if(front)col=mix(col,lc*(.94+.14*m),t.a*.95);else col=mix(col,mix(col,lc,.55)*.97,t.a*.22);}}
 gl_FragColor=vec4(col,1.0);
}`;

function makeSim(CX, CY) {
  const N = CX * CY;
  const SN = SX * SY;
  return {
    CX, CY, N, SN,
    H: new Float32Array(N), V: new Float32Array(N), Z: new Float32Array(N), SH: new Float32Array(N),
    proj: new Float32Array(N * 2), dep: new Float32Array(N),
    TW: new Float32Array(N * 3), RW: new Float32Array(N * 3), // rest / rendered world positions (view space)
    TC: new Float32Array(SN * 3), // rest position of each cloth node
    SP: new Float32Array(SN * 3), SO: new Float32Array(SN * 3), SD: new Float32Array(SN * 3), SM: new Float32Array(SN * 3), TP: new Float32Array(SN * 3),
    // render vertex -> cloth cell (a, b) and weights; cloth node -> render coordinates
    gi: new Float32Array(CX), gj: new Float32Array(CY),
  };
}

// Cloth links: structural (no stretch), shear, and very weak bending so it folds like tissue.
function makeLinks() {
  const CON = [];
  const sid = (a, b) => b * SX + a;
  for (let b = 0; b < SY; b += 1) {
    for (let a = 0; a < SX; a += 1) {
      const p = sid(a, b);
      if (a < SX - 1) CON.push([p, sid(a + 1, b), 1]);
      if (b < SY - 1) CON.push([p, sid(a, b + 1), 1]);
      if (a < SX - 1 && b < SY - 1) { CON.push([p, sid(a + 1, b + 1), 0.55]); CON.push([sid(a + 1, b), sid(a, b + 1), 0.55]); }
      if (a < SX - 2) CON.push([p, sid(a + 2, b), 0.12]);
      if (b < SY - 2) CON.push([p, sid(a, b + 2), 0.12]);
    }
  }
  return CON;
}

// One ripple step: wave equation on the height field + a soft random auto-ripple every few seconds.
function step(sim, st, dt) {
  const { CX, CY, N, H, V } = sim;
  st.time += dt;
  for (let k = 0; k < 2; k += 1) {
    for (let j = 1; j < CY - 1; j += 1) {
      for (let i = 1; i < CX - 1; i += 1) {
        const n = j * CX + i;
        const lap = H[n - 1] + H[n + 1] + H[n - CX] + H[n + CX] - 4 * H[n];
        V[n] = (V[n] + lap * 0.45) * 0.988 - H[n] * 0.003;
      }
    }
    for (let n = 0; n < N; n += 1) H[n] += V[n] * 0.5;
  }
  st.auto -= dt;
  if (st.auto <= 0) {
    st.auto = 2.8 + Math.random() * 1.8;
    const m = Math.round(CX / 8);
    const n = (m + ((Math.random() * (CY - 2 * m)) | 0)) * CX + m + ((Math.random() * (CX - 2 * m)) | 0);
    for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) V[n + j * CX + i] -= 9 * Math.exp(-(i * i + j * j) / 3);
  }
}

// Billowing sheet in 3D (view space), the cloth displacement on top while it is active, projected 2D points,
// depth and a shade per vertex. At rest (cloth off) this is the original sheet code, unchanged in look and
// cost: the cloth path below (world positions, two-sided normals) runs only while it is lifted or settling.
function geometry(sim, st, cloth, W, Hh) {
  if (!cloth.active) {
    restGeometry(sim, st, W, Hh);
    return;
  }
  const { CX, CY, H, SH, proj, dep, TW, RW, TC, SD, gi, gj } = sim;
  const sw = W * 0.84;
  const sh = sw * 0.72;
  const cx = W / 2;
  const cy = Hh * 0.46;
  const f = W * 1.9;
  st.sw = sw; st.ccx = cx; st.ccy = cy; st.ff = f;
  const t = st.time;
  const ry = Math.sin(t * 0.23) * 0.24 - 0.1;
  const rx = 0.6 + Math.sin(t * 0.31) * 0.05;
  const rz = Math.sin(t * 0.17) * 0.05 - 0.06;
  const cyr = Math.cos(ry); const syr = Math.sin(ry);
  const cxr = Math.cos(rx); const sxr = Math.sin(rx);
  const czr = Math.cos(rz); const szr = Math.sin(rz);
  const rot = (x, y, z, out, o) => {
    const x1 = x * czr - y * szr; const y1 = x * szr + y * czr;
    const x2 = x1 * cyr + z * syr; const z2 = -x1 * syr + z * cyr;
    out[o] = x2; out[o + 1] = y1 * cxr - z2 * sxr; out[o + 2] = y1 * sxr + z2 * cxr;
  };
  // the phone mesh is coarser: scale its ripple height so both look the same (the 65-wide mesh is the preview's)
  const hk = sw * 0.0016 * (CX >= 64 ? 1 : 64 / CX);
  const surface = (u0, v0, h, out, o) => {
    const billow = Math.sin(u0 * 3.2 + t * 0.9) * Math.cos(v0 * 2.6 + t * 0.7) * sw * 0.035 + Math.sin((u0 + v0) * 4.4 - t * 1.1) * sw * 0.016;
    const edge = (Math.abs(u0) * 2) ** 3 * Math.sin(t * 1.3 + v0 * 5) * sw * 0.03 + (Math.abs(v0) * 2) ** 4 * Math.sin(t * 1.1 + u0 * 4) * sw * 0.012;
    rot(u0 * sw, v0 * sh, billow + edge + h * hk, out, o);
  };
  for (let j = 0; j < CY; j += 1) {
    for (let i = 0; i < CX; i += 1) {
      const n = j * CX + i;
      surface(i / (CX - 1) - 0.5, j / (CY - 1) - 0.5, H[n], TW, 3 * n);
    }
  }
  if (cloth.active) {
    // rest position of each cloth node (on the 65-wide mesh exactly every 2nd vertex, as in the preview)
    for (let b = 0; b < SY; b += 1) {
      for (let a = 0; a < SX; a += 1) {
        const s = b * SX + a;
        const fi = (a * (CX - 1)) / (SX - 1); const fj = (b * (CY - 1)) / (SY - 1);
        const i0 = Math.min(CX - 2, fi | 0); const j0 = Math.min(CY - 2, fj | 0); const ui = fi - i0; const vj = fj - j0;
        if (ui < 1e-6 && vj < 1e-6) {
          const n = 3 * (j0 * CX + i0);
          TC[3 * s] = TW[n]; TC[3 * s + 1] = TW[n + 1]; TC[3 * s + 2] = TW[n + 2];
        } else {
          const h = (H[j0 * CX + i0] * (1 - ui) + H[j0 * CX + i0 + 1] * ui) * (1 - vj) + (H[(j0 + 1) * CX + i0] * (1 - ui) + H[(j0 + 1) * CX + i0 + 1] * ui) * vj;
          surface(a / (SX - 1) - 0.5, b / (SY - 1) - 0.5, h, TC, 3 * s);
        }
      }
    }
  }
  // cloth displacement (coarse) spread smoothly over the fine mesh, so ripples stay crisp
  for (let j = 0; j < CY; j += 1) {
    for (let i = 0; i < CX; i += 1) {
      const n = j * CX + i;
      if (cloth.active) {
        const a = Math.min(SX - 2, gi[i] | 0); const b = Math.min(SY - 2, gj[j] | 0); const fx = gi[i] - a; const fy = gj[j] - b;
        const s00 = 3 * (b * SX + a); const s10 = s00 + 3; const s01 = s00 + 3 * SX; const s11 = s01 + 3;
        for (let k = 0; k < 3; k += 1) {
          const d = (SD[s00 + k] * (1 - fx) + SD[s10 + k] * fx) * (1 - fy) + (SD[s01 + k] * (1 - fx) + SD[s11 + k] * fx) * fy;
          RW[3 * n + k] = TW[3 * n + k] + d;
        }
      } else {
        RW[3 * n] = TW[3 * n]; RW[3 * n + 1] = TW[3 * n + 1]; RW[3 * n + 2] = TW[3 * n + 2];
      }
      const z3 = RW[3 * n + 2]; const s = f / (f + z3);
      proj[2 * n] = cx + RW[3 * n] * s;
      proj[2 * n + 1] = cy + RW[3 * n + 1] * s;
      dep[n] = z3;
    }
  }
  // light = the original sheet light, carried into view space; two-sided so folds and the back light softly
  const L = [0, 0, 0];
  rot(-0.45, -0.55, 0.7, L, 0);
  for (let j = 0; j < CY; j += 1) {
    for (let i = 0; i < CX; i += 1) {
      const n = j * CX + i;
      const a = 3 * (j * CX + Math.max(0, i - 1)); const b = 3 * (j * CX + Math.min(CX - 1, i + 1));
      const c = 3 * (Math.max(0, j - 1) * CX + i); const d = 3 * (Math.min(CY - 1, j + 1) * CX + i);
      const ux = RW[b] - RW[a]; const uy = RW[b + 1] - RW[a + 1]; const uz = RW[b + 2] - RW[a + 2];
      const vx = RW[d] - RW[c]; const vy = RW[d + 1] - RW[c + 1]; const vz = RW[d + 2] - RW[c + 2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      SH[n] = Math.abs(nx * L[0] + ny * L[1] + nz * L[2]) / (Math.hypot(nx, ny, nz) || 1);
    }
  }
}

// The original sheet (no cloth): billow + ripples, projected, shaded from the height gradient.
function restGeometry(sim, st, W, Hh) {
  const { CX, CY, H, Z, SH, proj, dep } = sim;
  const sw = W * 0.84;
  const sh = sw * 0.72;
  const cx = W / 2;
  const cy = Hh * 0.46;
  const f = W * 1.9;
  st.sw = sw; st.ccx = cx; st.ccy = cy; st.ff = f;
  const t = st.time;
  const ry = Math.sin(t * 0.23) * 0.24 - 0.1;
  const rx = 0.6 + Math.sin(t * 0.31) * 0.05;
  const rz = Math.sin(t * 0.17) * 0.05 - 0.06;
  const cyr = Math.cos(ry); const syr = Math.sin(ry);
  const cxr = Math.cos(rx); const sxr = Math.sin(rx);
  const czr = Math.cos(rz); const szr = Math.sin(rz);
  const hk = sw * 0.0016 * (CX >= 64 ? 1 : 64 / CX);
  for (let j = 0; j < CY; j += 1) {
    for (let i = 0; i < CX; i += 1) {
      const n = j * CX + i;
      const u0 = i / (CX - 1) - 0.5;
      const v0 = j / (CY - 1) - 0.5;
      const billow = Math.sin(u0 * 3.2 + t * 0.9) * Math.cos(v0 * 2.6 + t * 0.7) * sw * 0.035 + Math.sin((u0 + v0) * 4.4 - t * 1.1) * sw * 0.016;
      const edge = (Math.abs(u0) * 2) ** 3 * Math.sin(t * 1.3 + v0 * 5) * sw * 0.03 + (Math.abs(v0) * 2) ** 4 * Math.sin(t * 1.1 + u0 * 4) * sw * 0.012;
      const x = u0 * sw;
      const y = v0 * sh;
      const z = billow + edge + H[n] * hk;
      Z[n] = z;
      const x1 = x * czr - y * szr; const y1 = x * szr + y * czr;
      const x2 = x1 * cyr + z * syr; const z2 = -x1 * syr + z * cyr;
      const y3 = y1 * cxr - z2 * sxr; const z3 = y1 * sxr + z2 * cxr;
      const s = f / (f + z3);
      proj[2 * n] = cx + x2 * s;
      proj[2 * n + 1] = cy + y3 * s;
      dep[n] = z3;
    }
  }
  const du = sw / (CX - 1);
  const dv = sh / (CY - 1);
  for (let j = 0; j < CY; j += 1) {
    for (let i = 0; i < CX; i += 1) {
      const n = j * CX + i;
      const a = Z[j * CX + Math.max(0, i - 1)]; const b = Z[j * CX + Math.min(CX - 1, i + 1)];
      const c = Z[Math.max(0, j - 1) * CX + i]; const d = Z[Math.min(CY - 1, j + 1) * CX + i];
      const nx = -(b - a) / (2 * du); const ny = -(d - c) / (2 * dv);
      SH[n] = (nx * -0.45 + ny * -0.55 + 0.7) / Math.hypot(nx, ny, 1);
    }
  }
}

// The Verlet cloth, one frame (f = frames at 60 fps, at most 2). Settles back to the sheet after release.
function clothStep(sim, st, C, CON, REST, f, still) {
  const { SN, TC, SP, SO, SD, SM, TP } = sim;
  const now = performance.now();
  // return to rest: gravity fades out, air slows it, and the pull home eases in so it floats back
  let rel = 0;
  if (C.grab) C.k = 0.0015;
  else { const tt = (now - C.relT) / 1000; const e = Math.min(1, tt / 4.6); rel = Math.min(1, tt / 1.8); C.k = 0.0008 + 0.026 * e * e * (3 - 2 * e); }
  const g = 0.3 * f * f * (C.grab ? 1 : 0.22 * (1 - rel));
  // reduced motion: no inertia (no swing), no flutter
  const damp = still ? 0 : (C.grab ? 0.955 : 0.925) ** f;
  const floorY = st.H * 0.94 - st.ccy;
  const side = st.W * 0.5 - 4;
  for (let s = 0; s < SN; s += 1) {
    const o = 3 * s;
    for (let k = 0; k < 3; k += 1) { const dT = TC[o + k] - TP[o + k]; TP[o + k] = TC[o + k]; if (!C.grab) { SP[o + k] += dT; SO[o + k] += dT; } }
    for (let k = 0; k < 3; k += 1) { const p = SP[o + k]; const v = (p - SO[o + k]) * damp; SO[o + k] = p; SP[o + k] = p + v + (k === 1 ? g : 0); }
    // air: tiny flutter so it never looks rigid
    if (C.grab && !still) SP[o + 2] += Math.sin(st.time * 3.1 + s * 0.7) * 0.06 * f;
    for (let k = 0; k < 3; k += 1) SP[o + k] += (TC[o + k] - SP[o + k]) * Math.min(1, C.k * f);
  }
  let pinX = 0; let pinY = 0; let pinZ = 0;
  if (C.grab && C.pin >= 0) {
    const lift = Math.min(1, (now - C.grabT) / 350) * st.sw * 0.14;
    pinZ = C.zg - lift;
    const sc = st.ff / (st.ff + pinZ);
    pinX = (C.px - st.ccx) / sc;
    pinY = (C.py - st.ccy) / sc;
  }
  for (let it = 0; it < 10; it += 1) {
    for (let q = 0; q < CON.length; q += 1) {
      const c = CON[q]; const p = 3 * c[0]; const r = 3 * c[1];
      const dx = SP[r] - SP[p]; const dy = SP[r + 1] - SP[p + 1]; const dz = SP[r + 2] - SP[p + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const diff = ((d - REST[q]) / d) * 0.5 * c[2] * (c[2] < 1 && d < REST[q] ? 0.35 : 1); // bending resists stretching fully, creasing only a little
      SP[p] += dx * diff; SP[p + 1] += dy * diff; SP[p + 2] += dz * diff;
      SP[r] -= dx * diff; SP[r + 1] -= dy * diff; SP[r + 2] -= dz * diff;
    }
    if (C.grab && C.pin >= 0) {
      const o = 3 * C.pin;
      SP[o] += (pinX - SP[o]) * 0.6; SP[o + 1] += (pinY - SP[o + 1]) * 0.6; SP[o + 2] += (pinZ - SP[o + 2]) * 0.6;
    }
    for (let s = 0; s < SN; s += 1) {
      const o = 3 * s;
      if (SP[o + 1] > floorY) {
        SP[o + 1] = floorY;
        SO[o] = SP[o] - (SP[o] - SO[o]) * 0.15; SO[o + 1] = SP[o + 1]; SO[o + 2] = SP[o + 2] - (SP[o + 2] - SO[o + 2]) * 0.15;
      }
      if (SP[o] > side) SP[o] = side; else if (SP[o] < -side) SP[o] = -side;
      if (SP[o + 1] < -st.ccy + 4) SP[o + 1] = -st.ccy + 4;
    }
  }
  let maxD = 0;
  for (let s = 0; s < SN; s += 1) {
    const o = 3 * s;
    for (let k = 0; k < 3; k += 1) SD[o + k] = SP[o + k] - TC[o + k];
    maxD = Math.max(maxD, Math.abs(SD[o]) + Math.abs(SD[o + 1]) + Math.abs(SD[o + 2]));
  }
  for (let pass = 0; pass < 2; pass += 1) {
    SM.set(SD);
    for (let bb = 1; bb < SY - 1; bb += 1) {
      for (let aa = 1; aa < SX - 1; aa += 1) {
        const s0 = bb * SX + aa; const o = 3 * s0;
        if (s0 === C.pin) continue;
        for (let k = 0; k < 3; k += 1) SD[o + k] = SM[o + k] * 0.5 + (SM[o - 3 + k] + SM[o + 3 + k] + SM[o - 3 * SX + k] + SM[o + 3 * SX + k]) * 0.125;
      }
    }
  }
  // last little bit fades out smoothly instead of snapping
  if (!C.grab) {
    const tt = (now - C.relT) / 1000; const fd = tt < 4.2 ? 1 : Math.max(0, 1 - (tt - 4.2) / 2); const fe = fd * fd * (3 - 2 * fd);
    if (fe < 1) { for (let q = 0; q < SD.length; q += 1) SD[q] *= fe; maxD *= fe; }
  }
  C.maxD = maxD;
  if (!C.grab && ((now - C.relT > 1500 && maxD < 0.6) || now - C.relT > 6400)) { C.active = false; SD.fill(0); }
}

function glRenderer(gl, sim) {
  const { CX, CY, N, SH, proj, dep } = sim;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  // Two programs on the same buffers (attribute locations bound alike): the original one while the sheet rests,
  // the two-sided one only while the cloth is active.
  const program = (fs) => {
    const pg = gl.createProgram();
    gl.attachShader(pg, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(pg, shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(pg, 0, 'p');
    gl.bindAttribLocation(pg, 1, 'uv');
    gl.bindAttribLocation(pg, 2, 's');
    gl.linkProgram(pg);
    return gl.getProgramParameter(pg, gl.LINK_STATUS) ? pg : null;
  };
  const progRest = program(FS_REST);
  const progCloth = program(FS);
  if (!progRest || !progCloth) return null;
  let current = progRest;
  gl.useProgram(current);
  const pos = new Float32Array(N * 3);
  const uvs = new Float32Array(N * 2);
  for (let j = 0; j < CY; j += 1) for (let i = 0; i < CX; i += 1) { const n = j * CX + i; uvs[2 * n] = i / (CX - 1); uvs[2 * n + 1] = j / (CY - 1); }
  const ind = new Uint16Array((CX - 1) * (CY - 1) * 6);
  let k = 0;
  for (let j = 0; j < CY - 1; j += 1) {
    for (let i = 0; i < CX - 1; i += 1) {
      const a = j * CX + i; const b = a + 1; const c = a + CX; const d = c + 1;
      ind.set([a, b, d, a, d, c], k);
      k += 6;
    }
  }
  const mk = (data, loc, size, dyn) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const l = ['p', 'uv', 's'].indexOf(loc);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
    return b;
  };
  const bP = mk(pos, 'p', 3, true);
  mk(uvs, 'uv', 2, false);
  const bS = mk(SH, 's', 1, true);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  const lw = 0.36;
  const lh = lw * ICON_RATIO * (1 / 0.72);
  const uniforms = (has) => {
    for (const pg of [progRest, progCloth]) {
      gl.useProgram(pg);
      gl.uniform1f(gl.getUniformLocation(pg, 'hasTex'), has);
      gl.uniform4f(gl.getUniformLocation(pg, 'R'), 0.5 - lw / 2, 0.5 - lh / 2 - 0.04, lw, lh);
    }
    gl.useProgram(current);
  };
  uniforms(0);

  const setTexture = (icon) => {
    const tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, icon);
    } catch (e) {
      return; // cross-origin image without CORS: plain sheet
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uniforms(1);
  };

  return {
    setTexture,
    draw(W, H, dpr, lifted) {
      const want = lifted ? progCloth : progRest;
      if (want !== current) { current = want; gl.useProgram(current); }
      for (let n = 0; n < N; n += 1) {
        pos[3 * n] = (proj[2 * n] / W) * 2 - 1;
        pos[3 * n + 1] = 1 - (proj[2 * n + 1] / H) * 2;
        pos[3 * n + 2] = Math.max(-0.98, Math.min(0.98, dep[n] / (W * 2)));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, bP);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, bS);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, SH);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, ind.length, gl.UNSIGNED_SHORT, 0);
    },
  };
}

function canvasRenderer(ctx, sim) {
  const { CX, CY, SH, proj, dep } = sim;
  return {
    setTexture() {},
    draw(W, H, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const stp = 2;
      const quads = [];
      for (let j = 0; j < CY - stp; j += stp) for (let i = 0; i < CX - stp; i += stp) { const n = j * CX + i; quads.push([n, dep[n]]); }
      quads.sort((p, q) => q[1] - p[1]);
      for (const [n] of quads) {
        const m = Math.max(0, Math.min(1, (SH[n] - 0.55) * 3));
        const c = `rgb(${(223 + 32 * m) | 0},${(213 + 41 * m) | 0},${(194 + 57 * m) | 0})`;
        ctx.fillStyle = c;
        ctx.strokeStyle = c;
        ctx.lineWidth = 1;
        const b = n + stp; const cc = n + stp * CX; const d = cc + stp;
        ctx.beginPath();
        ctx.moveTo(proj[2 * n], proj[2 * n + 1]);
        ctx.lineTo(proj[2 * b], proj[2 * b + 1]);
        ctx.lineTo(proj[2 * d], proj[2 * d + 1]);
        ctx.lineTo(proj[2 * cc], proj[2 * cc + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
  };
}

export default function TissueSheet() {
  const t = useT();
  const reduced = useReducedMotion();
  const boxRef = useRef(null);
  const [touched, setTouched] = useState(false);
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    // A new canvas per run: the old one's WebGL context is released on cleanup and cannot be reused.
    const cv = document.createElement('canvas');
    box.appendChild(cv);
    const small = window.matchMedia('(max-width: 700px), (pointer: coarse)').matches;
    const sim = small ? makeSim(40, 30) : makeSim(65, 49);
    const { CX, CY, N } = sim;
    for (let i = 0; i < CX; i += 1) sim.gi[i] = (i * (SX - 1)) / (CX - 1);
    for (let j = 0; j < CY; j += 1) sim.gj[j] = (j * (SY - 1)) / (CY - 1);
    const st = { time: reduced ? 1.2 : 0, auto: 1.2, W: 0, H: 0, sw: 0, ccx: 0, ccy: 0, ff: 1 };
    const CON = makeLinks();
    const REST = new Float32Array(CON.length);
    // cloth state (also on the element as __tissue for the motion checks, like the preview's window.__tissue)
    const C = { active: false, grab: false, pin: -1, px: 0, py: 0, zg: 0, k: 1, relT: 0, grabT: 0, maxD: 0, press: null, holdT: 0 };
    box.__tissue = C;
    let dpr = 1;
    let touchT = 0;
    let frame = 0;

    const gl = cv.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    const r = (gl && glRenderer(gl, sim)) || canvasRenderer(cv.getContext('2d'), sim);
    const icon = new Image();
    icon.crossOrigin = 'anonymous';
    icon.decoding = 'async';

    const render = () => {
      geometry(sim, st, C, st.W, st.H);
      r.draw(st.W, st.H, dpr, C.active);
    };
    const size = () => {
      const b = box.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      st.W = b.width;
      st.H = b.height;
      cv.width = Math.round(st.W * dpr);
      cv.height = Math.round(st.H * dpr);
      if (gl) gl.viewport(0, 0, cv.width, cv.height);
      if (st.W && !loop.isRunning()) render(); // a still frame follows the size until the loop runs
    };

    icon.onload = () => {
      r.setTexture(icon);
      if (!loop.isRunning()) render();
    };

    const loop = createLoop('sheet', (dt, now) => {
      if (reduced) {
        // still sheet: only a lifted cloth moves (no ripples, no billow); the loop ends with it
        if (C.active) clothStep(sim, st, C, CON, REST, Math.min(2, dt * 60), true);
        render();
        return C.active;
      }
      // idle (no touch for 2.5 s, cloth at rest): every other frame is enough
      if (!C.active && now - touchT > 2500 && (frame++ & 1)) return true;
      step(sim, st, dt);
      if (C.active) {
        clothStep(sim, st, C, CON, REST, Math.min(2, dt * 60), false);
        if (!C.active) box.dataset.cloth = 'rest'; // fully settled: physics off
      }
      render();
      return true;
    });

    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    icon.src = mediaUrl(ICON);

    const nearest = (px, py) => {
      const { proj } = sim;
      let best = -1;
      let bd = 1e9;
      for (let n = 0; n < N; n += 1) {
        const dx = proj[2 * n] - px; const dy = proj[2 * n + 1] - py; const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
      return [best, bd];
    };
    const impulse = (px, py, s) => {
      if (reduced) return; // still sheet: no ripples
      const { V } = sim;
      const [best, bd] = nearest(px, py);
      if (best < 0 || bd > (st.W * 0.08) ** 2) return;
      const bi = best % CX; const bj = (best / CX) | 0;
      const R = Math.round((5 * CX) / 64);
      for (let j = -R; j <= R; j += 1) {
        for (let i = -R; i <= R; i += 1) {
          const ii = bi + i; const jj = bj + j;
          if (ii < 1 || jj < 1 || ii >= CX - 1 || jj >= CY - 1) continue;
          V[jj * CX + ii] += s * Math.exp(-(i * i + j * j) / ((7 * R * R) / 25));
        }
      }
    };
    // the mesh vertex under the pointer, if it is on the sheet
    const zoneAt = (px, py) => {
      const [n, bd] = nearest(px, py);
      if (n < 0 || bd > (st.W * 0.07) ** 2) return null;
      return { i: n % CX, j: (n / CX) | 0 };
    };

    const startSim = () => {
      if (C.active) return;
      geometry(sim, st, { active: true }, st.W, st.H); // rest positions of the cloth nodes, this moment
      const { TC, SP, SO, TP, SD } = sim;
      SP.set(TC); SO.set(TC); TP.set(TC); SD.fill(0);
      CON.forEach((c, q) => {
        const p = 3 * c[0]; const s = 3 * c[1];
        REST[q] = Math.hypot(SP[p] - SP[s], SP[p + 1] - SP[s + 1], SP[p + 2] - SP[s + 2]);
      });
      C.active = true;
    };
    const pickUp = () => {
      const P = C.press;
      if (!P || C.grab) return;
      clearTimeout(C.holdT);
      startSim();
      const a = Math.min(SX - 1, Math.round(sim.gi[P.z.i])); const b = Math.min(SY - 1, Math.round(sim.gj[P.z.j]));
      C.pin = b * SX + a;
      C.zg = sim.SP[3 * C.pin + 2];
      C.grab = true;
      C.grabT = performance.now();
      setTurning(true);
      box.dataset.cloth = 'held';
      track('tissue_turn', {});
      if (!loop.isRunning()) loop.start(); // reduced motion: the loop runs only while it is lifted
    };
    const release = () => {
      C.grab = false;
      C.pin = -1;
      C.relT = performance.now();
      setTurning(false);
      if (reduced) { // back to rest at once
        C.active = false;
        sim.SD.fill(0);
        box.dataset.cloth = 'rest';
        loop.stop();
        render();
      } else {
        box.dataset.cloth = 'settling';
      }
    };

    let lx = null;
    let ly = null;
    const pt = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    const onMove = (e) => {
      touchT = performance.now();
      const [x, y] = pt(e);
      if (C.press && !C.grab) {
        C.px = x; C.py = y;
        if (Math.hypot(x - C.press.x, y - C.press.y) > MOVE_PX) pickUp();
        return;
      }
      if (C.grab) {
        C.px = Math.max(6, Math.min(st.W - 6, x));
        C.py = Math.max(6, Math.min(st.H - 6, y));
        if (reduced) render();
        return;
      }
      if (lx != null) impulse(x, y, -Math.min(40, Math.hypot(x - lx, y - ly)) * 0.55);
      lx = x;
      ly = y;
      if (!reduced) setTouched(true);
    };
    const onLeave = () => { if (!C.grab) { lx = null; ly = null; } };
    const onDown = (e) => {
      touchT = performance.now();
      const [x, y] = pt(e);
      if (!reduced) setTouched(true);
      const z = zoneAt(x, y);
      if (z) {
        C.press = { z, x, y };
        C.px = x; C.py = y;
        try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        clearTimeout(C.holdT);
        C.holdT = setTimeout(pickUp, HOLD_MS);
      } else {
        impulse(x, y, -46);
      }
      if (!reduced && Math.random() < 0.5) burst(e.clientX, e.clientY, 8);
    };
    const onEnd = () => {
      if (C.press && !C.grab) { // a tap: a ripple where it landed
        clearTimeout(C.holdT);
        impulse(C.press.x, C.press.y, -46);
        C.press = null;
        return;
      }
      C.press = null;
      if (!C.grab) return;
      release();
      lx = null;
      ly = null;
    };

    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointerup', onEnd);
    cv.addEventListener('pointercancel', onEnd);
    box.dataset.cloth = 'rest'; // rest | held | settling (read by the motion checks)

    let stopWatch = () => {};
    let cancelStart = () => {};
    if (!reduced) {
      cancelStart = afterLoad(() => {
        stopWatch = watchActive(box, (active) => (active ? loop.start() : loop.stop()));
      });
    }
    const onLost = (e) => { e.preventDefault(); loop.stop(); };
    cv.addEventListener('webglcontextlost', onLost);

    return () => {
      loop.stop();
      cancelStart();
      stopWatch();
      clearTimeout(C.holdT);
      ro.disconnect();
      icon.onload = null;
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointerup', onEnd);
      cv.removeEventListener('pointercancel', onEnd);
      cv.removeEventListener('webglcontextlost', onLost);
      delete box.__tissue;
      // free the GPU context now instead of waiting for garbage collection
      if (gl) {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      cv.remove();
    };
  }, [reduced]);

  return (
    <div
      ref={boxRef}
      className={`sheet${touched ? ' touched' : ''}${turning ? ' turning' : ''}${reduced ? ' still' : ''}`}
      role="img"
      aria-label={t('sheet_label')}
    >
      <div className="floor" />
    </div>
  );
}
