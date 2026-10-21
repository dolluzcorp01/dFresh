// Report charts (Commerce > Reports): inline SVG, no chart library. Three forms, picked by the report:
// - line: change over time (sales by day), the period and the previous one; crosshair + one tooltip with both series.
// - bar: a few values in order (months, ageing buckets, the stock movement); hover tooltip per column.
// - hbar: ranked categories (top SKUs, customers, reasons); the value at the bar's tip.
// Marks: bars <= 18px thick with a 4px rounded data end and a square baseline, 2px lines with 8px end dots ringed in the
// surface colour, hairline gridlines; a legend only with two series; text always in ink, never the series colour.
// Colours: the validated reference palette, slots 1-2 (blue current, orange previous; dataviz validator: all pass).
// The table under the chart carries every value (the chart never gates a number).
import { useMemo, useRef, useState } from 'react';

const C = { s1: '#2a78d6', s2: '#eb6834', grid: '#e8e4d8', axis: '#6b675e', ink: '#121214', ink2: '#4a4840', surface: '#ffffff' };
const compact = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : String(Math.round(a * 100) / 100);
  return `${v < 0 ? '-' : ''}${s.replace('.0', '')}`;
};
const full = (v) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
/** clean ticks from min (<= 0) to max */
function ticks(min, max) {
  const span = Math.max(max - min, 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const lo = Math.floor(min / step) * step; const hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
/** a bar: square at the baseline, 4px rounded at the data end (vertical: up or down; horizontal: right) */
function barPath(x, y0, w, y1, horizontal) {
  const r = 4;
  if (horizontal) { const len = y1 - y0; if (len < r) return `M${y0},${x}h${Math.max(len, 0)}v${w}h${-Math.max(len, 0)}z`; return `M${y0},${x}h${len - r}q${r},0 ${r},${r}v${w - 2 * r}q0,${r} ${-r},${r}h${-(len - r)}z`; }
  const up = y1 < y0; const h = Math.abs(y0 - y1);
  if (h < r) return `M${x},${y0}v${up ? -h : h}h${w}v${up ? h : -h}z`;
  return up ? `M${x},${y0}v${-(h - r)}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}v${h - r}z` : `M${x},${y0}v${h - r}q0,${r} ${r},${r}h${w - 2 * r}q${r},0 ${r},${-r}v${-(h - r)}z`;
}

export default function ReportChart({ chart, money = true }) {
  const box = useRef(null);
  const [tip, setTip] = useState(null); // { x, y, title, rows: [[name, value, colour]] }
  const W = 760;
  const kind = chart.kind;
  const series = chart.series;
  const n = chart.x.length;
  const H = kind === 'hbar' ? Math.max(120, n * 30 + 30) : 260;
  const L = kind === 'hbar' ? 230 : 56; const R = kind === 'hbar' ? 70 : 16; const T = 14; const B = kind === 'hbar' ? 24 : 40;
  const all = series.flatMap((s) => s.values);
  const tk = useMemo(() => ticks(Math.min(0, ...all), Math.max(0, ...all)), [all.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const vmin = tk[0]; const vmax = tk[tk.length - 1];
  const fmt = (v) => (money ? `Rs ${full(v)}` : full(v));
  const show = (e, title, rows) => {
    const r = box.current.getBoundingClientRect();
    setTip({ x: Math.min(e.clientX - r.left + 12, r.width - 190), y: e.clientY - r.top + 12, title, rows });
  };
  const legend = series.length > 1 && (
    <div className="a-chart-legend">{series.map((s, i) => <span key={s.name}><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={i ? C.s2 : C.s1} strokeWidth="2" strokeLinecap="round" /></svg> {s.name}</span>)}</div>
  );
  let body;
  if (kind === 'hbar') {
    const sc = (v) => L + ((v - vmin) / (vmax - vmin || 1)) * (W - L - R);
    const band = (H - T - B) / n; const bw = Math.min(18, band - 6);
    body = (
      <>
        {tk.map((v) => <g key={v}><line x1={sc(v)} x2={sc(v)} y1={T} y2={H - B} stroke={C.grid} strokeWidth="1" /><text x={sc(v)} y={H - 6} fontSize="11" fill={C.axis} textAnchor="middle">{compact(v)}</text></g>)}
        {chart.x.map((label, i) => {
          const v = series[0].values[i]; const y = T + i * band + (band - bw) / 2;
          const x0 = sc(0); const x1 = sc(v);
          return (
            <g key={label} tabIndex={0} onPointerMove={(e) => show(e, label, [[series[0].name, v, C.s1]])} onPointerLeave={() => setTip(null)} onFocus={(e) => show({ clientX: e.target.getBoundingClientRect().left + 200, clientY: e.target.getBoundingClientRect().top }, label, [[series[0].name, v, C.s1]])} onBlur={() => setTip(null)}>
              <rect x={0} y={T + i * band} width={W} height={band} fill="transparent" />
              <text x={L - 8} y={y + bw / 2 + 4} fontSize="12" fill={C.ink2} textAnchor="end">{label.length > 34 ? `${label.slice(0, 33)}…` : label}</text>
              <path d={v >= 0 ? barPath(y, x0, bw, x1, true) : barPath(y, x1, bw, x0, true)} fill={C.s1} />
              <text x={Math.max(x0, x1) + 6} y={y + bw / 2 + 4} fontSize="12" fill={C.ink}>{compact(v)}</text>
            </g>
          );
        })}
      </>
    );
  } else {
    const sy = (v) => T + (1 - (v - vmin) / (vmax - vmin || 1)) * (H - T - B);
    const step = (W - L - R) / Math.max(n, 1);
    const labelEvery = Math.ceil(n / 12);
    const grid = tk.map((v) => <g key={v}><line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? C.axis : C.grid} strokeWidth="1" /><text x={L - 8} y={sy(v) + 4} fontSize="11" fill={C.axis} textAnchor="end">{compact(v)}</text></g>);
    const xl = chart.x.map((x, i) => (i % labelEvery === 0 ? <text key={x} x={L + step * i + step / 2} y={H - 18} fontSize="11" fill={C.axis} textAnchor="middle">{String(x).length === 10 ? String(x).slice(8) : x}</text> : null));
    if (kind === 'bar') {
      const bw = Math.min(18, step - 4);
      body = (<>{grid}{xl}{chart.x.map((x, i) => {
        const v = series[0].values[i]; const cx = L + step * i + (step - bw) / 2;
        return (
          <g key={x} tabIndex={0} onPointerMove={(e) => show(e, x, [[series[0].name, v, C.s1]])} onPointerLeave={() => setTip(null)}>
            <rect x={L + step * i} y={T} width={step} height={H - T - B} fill="transparent" />
            <path d={barPath(cx, sy(0), bw, sy(v), false)} fill={C.s1} />
            {n <= 12 && <text x={cx + bw / 2} y={v >= 0 ? sy(v) - 5 : sy(v) + 14} fontSize="11" fill={C.ink} textAnchor="middle">{compact(v)}</text>}
          </g>
        );
      })}</>);
    } else {
      const px = (i) => L + step * i + step / 2;
      const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${px(i)},${sy(v)}`).join('');
      const hover = tip ? tip.i : null; // the crosshair follows the tooltip's day
      body = (
        <>
          {grid}{xl}
          {series.map((s, si) => <path key={s.name} d={path(s.values)} fill="none" stroke={si ? C.s2 : C.s1} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
          {series.map((s, si) => <circle key={`${s.name}-end`} cx={px(s.values.length - 1)} cy={sy(s.values[s.values.length - 1])} r="4" fill={si ? C.s2 : C.s1} stroke={C.surface} strokeWidth="2" />)}
          {hover !== null && hover !== undefined && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} stroke={C.axis} strokeWidth="1" />}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent"
            onPointerMove={(e) => {
              const r = e.currentTarget.ownerSVGElement.getBoundingClientRect();
              const i = Math.max(0, Math.min(n - 1, Math.floor((((e.clientX - r.left) / r.width) * W - L) / step)));
              const rr = box.current.getBoundingClientRect();
              setTip({ i, x: Math.min(e.clientX - rr.left + 12, rr.width - 210), y: 10, title: chart.x[i], rows: series.map((s, si) => [s.name, s.values[i] ?? 0, si ? C.s2 : C.s1]) });
            }}
            onPointerLeave={() => setTip(null)} />
        </>
      );
    }
  }
  return (
    <figure className="a-chart" ref={box}>
      {chart.title && <figcaption>{chart.title}</figcaption>}
      {legend}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${chart.title || 'Chart'}: the values are in the table below`}>{body}</svg>
      {tip && (
        <div className="a-chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
          <div className="a-chart-tip-t">{tip.title}</div>
          {tip.rows.map(([name, v, c]) => <div key={name}><svg width="12" height="8" aria-hidden="true"><line x1="0" y1="4" x2="12" y2="4" stroke={c} strokeWidth="2" /></svg> <b>{fmt(v)}</b> <span>{name}</span></div>)}
        </div>
      )}
    </figure>
  );
}
