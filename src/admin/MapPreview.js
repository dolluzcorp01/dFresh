// The site's "Where we deliver" map in the admin (phase 24: Website > Where we deliver map; before, the Towns drawer):
// the same land, pins and name sizes as src/home/WhereMap.js, with the town being edited drawn from the unsaved values.
// Drag its pin to set Map x / y, drag its name to set the name offsets (the fields follow live). The other towns on the
// map are shown faded. Nothing is saved until Save.
import { useRef, useState } from 'react';
import { LAND, MAP_H, MAP_W } from '../shared/mapShape';

export const placed = (t) => Boolean(t) && t.map_x !== null && t.map_x !== undefined && t.map_x !== '' && t.map_y !== null && t.map_y !== undefined && t.map_y !== '';

/** others: [{ id, name, map_x, map_y, is_base, label_dx, label_dy, label_anchor }]; town: the one being edited (same shape) */
export default function MapPreview({ others, town, onMove, disabled }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'pin' | 'name'
  const at = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.round(Math.min(MAP_W, Math.max(0, p.x))), y: Math.round(Math.min(MAP_H, Math.max(0, p.y))) };
  };
  const start = (what) => (e) => {
    if (disabled) return;
    e.preventDefault();
    svgRef.current.setPointerCapture(e.pointerId);
    setDragging(what);
  };
  const move = (e) => {
    if (!dragging) return;
    const p = at(e);
    if (dragging === 'pin') onMove({ map_x: p.x, map_y: p.y });
    else onMove({ label_dx: p.x - Number(town.map_x), label_dy: p.y - Number(town.map_y) });
  };
  const pin = (t, current) => {
    const x = Number(t.map_x);
    const y = Number(t.map_y);
    const base = Number(t.is_base) === 1;
    return (
      <g key={t.id ?? 'new'} opacity={current ? 1 : 0.35} className={current && !disabled ? 'a-tp-cur' : undefined}>
        <circle cx={x} cy={y} r={base ? 11 : 7} fill={base ? '#121214' : '#E5BF24'} stroke="#fff" strokeWidth="3"
          {...(current ? { onPointerDown: start('pin'), 'data-drag': 'pin' } : {})} />
        <text x={x + Number(t.label_dx || 0)} y={y + Number(t.label_dy || 0)} textAnchor={t.label_anchor || 'middle'}
          fontFamily="Saira, sans-serif" fontWeight="700" fontSize="18" fill="#121214"
          {...(current ? { onPointerDown: start('name'), 'data-drag': 'name' } : {})}>{t.name}{base ? ' ★' : ''}</text>
      </g>
    );
  };
  return (
    <figure className="a-townmap">
      <svg ref={svgRef} viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Preview of the delivery map"
        onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}
        className={dragging ? 'a-tp-dragging' : undefined}>
        <path d={LAND} fill="#FFF3CF" stroke="#EEE4C8" strokeWidth="2" />
        {others.filter(placed).map((t) => pin(t, false))}
        {town && placed(town) ? pin(town, true) : null}
      </svg>
      <figcaption className="a-muted">
        {!town ? 'The towns on the site map.'
          : placed(town)
            ? `${disabled ? '' : 'Drag the pin or the name to move them. '}This town in full colour, the others faded. Not saved until you press Save.`
            : 'Enter Map x and Map y to place this town.'}
      </figcaption>
    </figure>
  );
}
