// Hero tissue sheet (spec B1), ported from the preview: a WebGL sheet of paper with the dFresh leaf-hand
// icon printed in the centre, embossed dots, gently billowing; pointer move / tap makes ripples, soft
// random auto-ripples, confetti on tap. 2D canvas without WebGL; one still frame with reduced motion.
// Smaller mesh on phones. The loop runs only while the sheet is on screen and the tab is visible.
// Lazy-loaded (its own chunk) by Hero.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { mediaUrl } from '../utils/api';
import { afterLoad, createLoop, watchActive } from '../utils/loop';
import { burst } from '../utils/burst';
import useReducedMotion from '../utils/useReducedMotion';

const ICON = '/media/logo/dfresh-icon.webp'; // 512 x 333
const ICON_RATIO = 333 / 512;

const VS = 'attribute vec3 p;attribute vec2 uv;attribute float s;varying vec2 vU;varying float vS;void main(){vU=uv;vS=s;gl_Position=vec4(p,1.0);}';
const FS = `precision mediump float;varying vec2 vU;varying float vS;uniform sampler2D tex;uniform float hasTex;uniform vec4 R;
void main(){
 float m=clamp((vS-.55)*3.0,0.0,1.0);
 vec3 col=mix(vec3(.915,.885,.83),vec3(1.0,.998,.99),m);
 vec2 g=vec2(vU.x*40.0,vU.y*29.0);vec2 q=fract(vec2(g.x+g.y,g.x-g.y)*.5)-.5;float dot_=smoothstep(.16,.07,length(q));
 col*=1.0-dot_*.045;
 float e=min(min(vU.x,1.0-vU.x),min(vU.y,1.0-vU.y));col*=mix(.9,1.0,smoothstep(0.0,.018,e));
 if(hasTex>.5){vec2 lu=(vU-R.xy)/R.zw;if(lu.x>0.0&&lu.x<1.0&&lu.y>0.0&&lu.y<1.0){vec4 t=texture2D(tex,lu);col=mix(col,t.rgb/max(t.a,.001)*(.94+.14*m),t.a*.95);}}
 gl_FragColor=vec4(col,1.0);
}`;

function makeSim(CX, CY) {
  const N = CX * CY;
  return {
    CX, CY, N,
    H: new Float32Array(N), V: new Float32Array(N), Z: new Float32Array(N), SH: new Float32Array(N),
    proj: new Float32Array(N * 2), dep: new Float32Array(N),
  };
}

// One physics step: wave equation on the height field + a soft random auto-ripple every few seconds.
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

// Billowing sheet in 3D -> projected 2D points, depth and a shade per vertex.
function geometry(sim, st, W, Hh) {
  const { CX, CY, H, Z, SH, proj, dep } = sim;
  const sw = W * 0.84;
  const sh = sw * 0.72;
  const cx = W / 2;
  const cy = Hh * 0.46;
  const f = W * 1.9;
  const t = st.time;
  const ry = Math.sin(t * 0.23) * 0.24 - 0.1;
  const rx = 0.6 + Math.sin(t * 0.31) * 0.05;
  const rz = Math.sin(t * 0.17) * 0.05 - 0.06;
  const cyr = Math.cos(ry); const syr = Math.sin(ry);
  const cxr = Math.cos(rx); const sxr = Math.sin(rx);
  const czr = Math.cos(rz); const szr = Math.sin(rz);
  // the mesh resolution changes on phones; scale the ripple height so both look the same
  const hk = sw * 0.0016 * (64 / CX);
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

function glRenderer(gl, sim) {
  const { CX, CY, N, SH, proj, dep } = sim;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
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
    const l = gl.getAttribLocation(pr, loc);
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
  const uHas = gl.getUniformLocation(pr, 'hasTex');
  gl.uniform1f(uHas, 0);
  const lw = 0.36;
  const lh = lw * ICON_RATIO * (1 / 0.72);
  gl.uniform4f(gl.getUniformLocation(pr, 'R'), 0.5 - lw / 2, 0.5 - lh / 2 - 0.04, lw, lh);

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
    gl.uniform1f(uHas, 1);
  };

  return {
    setTexture,
    draw(W, Hh) {
      for (let n = 0; n < N; n += 1) {
        pos[3 * n] = (proj[2 * n] / W) * 2 - 1;
        pos[3 * n + 1] = 1 - (proj[2 * n + 1] / Hh) * 2;
        pos[3 * n + 2] = dep[n] / (W * 2);
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
    draw(W, Hh, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hh);
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

  useEffect(() => {
    const box = boxRef.current;
    // A new canvas per run: the old one's WebGL context is released on cleanup and cannot be reused.
    const cv = document.createElement('canvas');
    box.appendChild(cv);
    const small = window.matchMedia('(max-width: 700px), (pointer: coarse)').matches;
    const sim = small ? makeSim(40, 30) : makeSim(64, 48);
    const st = { time: reduced ? 1.2 : 0, auto: 1.2 };
    let W = 0;
    let Hh = 0;
    let dpr = 1;
    let touchT = 0;
    let frame = 0;

    const gl = cv.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    const r = (gl && glRenderer(gl, sim)) || canvasRenderer(cv.getContext('2d'), sim);
    const icon = new Image();
    icon.crossOrigin = 'anonymous';
    icon.decoding = 'async';

    const render = () => {
      geometry(sim, st, W, Hh);
      r.draw(W, Hh, dpr);
    };
    const size = () => {
      const b = box.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = b.width;
      Hh = b.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(Hh * dpr);
      if (gl) gl.viewport(0, 0, cv.width, cv.height);
      if (W && !loop.isRunning()) render(); // a still frame follows the size until the loop runs
    };

    icon.onload = () => {
      r.setTexture(icon);
      if (!loop.isRunning()) render();
    };

    const loop = createLoop('sheet', (dt, now) => {
      // idle (no touch for 2.5 s): every other frame is enough
      if (now - touchT > 2500 && (frame++ & 1)) return true;
      step(sim, st, dt);
      render();
      return true;
    });

    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    icon.src = mediaUrl(ICON);

    const impulse = (px, py, s) => {
      const { CX, CY, N, proj, V } = sim;
      let best = -1;
      let bd = 1e9;
      for (let n = 0; n < N; n += 1) {
        const dx = proj[2 * n] - px; const dy = proj[2 * n + 1] - py; const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
      if (best < 0 || bd > (W * 0.08) ** 2) return;
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
    let lx = null;
    let ly = null;
    const pt = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    const onMove = (e) => {
      touchT = performance.now();
      const [x, y] = pt(e);
      if (lx != null) impulse(x, y, -Math.min(40, Math.hypot(x - lx, y - ly)) * 0.55);
      lx = x;
      ly = y;
      setTouched(true);
    };
    const onLeave = () => { lx = null; ly = null; };
    const onDown = (e) => {
      touchT = performance.now();
      const [x, y] = pt(e);
      impulse(x, y, -46);
      setTouched(true);
      if (Math.random() < 0.5) burst(e.clientX, e.clientY, 8);
    };

    let stopWatch = () => {};
    let cancelStart = () => {};
    if (!reduced) {
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerleave', onLeave);
      cv.addEventListener('pointerdown', onDown);
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
      ro.disconnect();
      icon.onload = null;
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('webglcontextlost', onLost);
      // free the GPU context now instead of waiting for garbage collection
      if (gl) {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
      cv.remove();
    };
  }, [reduced]);

  return (
    <div ref={boxRef} className={`sheet${touched ? ' touched' : ''}${reduced ? ' still' : ''}`} role="img" aria-label={t('sheet_label')}>
      <div className="floor" />
      {!reduced && (
        <span className="hint" aria-hidden="true"><i /><span>{t('touch')}</span></span>
      )}
    </div>
  );
}
