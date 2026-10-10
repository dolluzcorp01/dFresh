// Where we deliver (spec B8): illustrated 600x360 map drawn from `towns` (pins at map_x / map_y, the base
// marked with a star, names translated and placed by label_dx / label_dy / label_anchor). When 30% of the map
// is visible the curved routes draw in one after another; then a small dFresh van drives each route in turn
// (1.7 s each, ease-in-out, 0.45 s stop), only while the map is on screen and the tab is visible.
// Reduced motion: routes shown drawn, no van, no pulsing.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import Reveal from '../components/Reveal';
import { useOpenForm } from '../forms/FormsProvider';
import { mediaUrl } from '../utils/api';
import { createLoop, watchActive } from '../utils/loop';
import useReducedMotion from '../utils/useReducedMotion';
import './WhereMap.css';

const LAND = 'M10 40 Q200 10 470 30 Q540 60 560 120 Q575 200 520 280 Q470 340 300 340 Q120 345 30 300 Q0 200 10 40Z';
const DRIVE_MS = 1700;
const STOP_MS = 450;
const FIRST_MS = 1500;

export default function WhereMap() {
  const { t, data } = useI18n();
  const openForm = useOpenForm();
  const reduced = useReducedMotion();
  const svgRef = useRef(null);
  const vanRef = useRef(null);
  const [drawn, setDrawn] = useState(false);
  const towns = data.towns.filter((tw) => tw.mapX !== null && tw.mapY !== null);
  const base = towns.find((tw) => tw.isBase) || towns[0];
  const others = towns.filter((tw) => tw !== base);
  const routeKey = others.map((tw) => `${tw.key}:${tw.mapX},${tw.mapY}`).join('|');

  // routes: dash = their own length, hidden until drawn
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    svg.querySelectorAll('.route').forEach((r) => {
      const l = r.getTotalLength();
      r.style.strokeDasharray = String(l);
      r.style.strokeDashoffset = drawn || reduced ? '0' : String(l);
    });
    if (drawn || reduced) return undefined;
    if (!('IntersectionObserver' in window)) {
      setDrawn(true);
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setDrawn(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(svg);
    return () => io.disconnect();
  }, [drawn, reduced, routeKey]);

  // the van: one route after another, forever, while on screen
  useEffect(() => {
    const svg = svgRef.current;
    const van = vanRef.current;
    if (!drawn || reduced || !svg || !van || !others.length) return undefined;
    const routes = [...svg.querySelectorAll('.route')];
    let k = 0;
    let t0 = 0; // start of the current drive (ms), shifted while paused
    let wait = FIRST_MS; // ms to wait before t0 counts
    let pausedAt = 0;
    let started = performance.now();
    const loop = createLoop('van', (dt, now) => {
      if (wait > 0) {
        if (now - started < wait) return true;
        t0 = started + wait; // the exact start time (preview: setTimeout), not this frame's
        wait = 0;
      }
      const r = routes[k];
      const L0 = r.getTotalLength();
      const p = Math.min(1, (now - t0) / DRIVE_MS);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const pt = r.getPointAtLength(e * L0);
      const pt2 = r.getPointAtLength(Math.min(L0, e * L0 + 1));
      const flip = pt2.x < pt.x ? -1 : 1;
      van.setAttribute('transform', `translate(${pt.x} ${pt.y - 8}) scale(${flip} 1)`);
      if (p >= 1) {
        k = (k + 1) % routes.length;
        wait = STOP_MS;
        started = now;
      }
      return true;
    });
    const stop = watchActive(svg, (active) => {
      if (active) {
        const gap = pausedAt ? performance.now() - pausedAt : 0;
        t0 += gap;
        started += gap;
        loop.start();
      } else {
        pausedAt = performance.now();
        loop.stop();
      }
    });
    return () => {
      loop.stop();
      stop();
      van.setAttribute('transform', 'translate(-100 -100)');
    };
  }, [drawn, reduced, routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!base) return null;
  const aria = t('map_aria', { base: base.name, towns: others.map((tw) => tw.name).join(', ') });

  return (
    <section className="sec where" id="where" aria-labelledby="where-h">
      <div className="wrap grid">
        <Reveal>
          <div className="sh left">
            <Kicker>{t('where_k')}</Kicker>
            <h2 id="where-h">{t('where_h')}</h2>
            <p>{t('where_p')}</p>
          </div>
          <div className="townlist">
            {towns.map((tw) => <span key={tw.key}>{tw.name}</span>)}
          </div>
          <div className="acts">
            <button type="button" className="btn b-ink" onClick={() => openForm('distributor')}><span>{t('become_distributor')}</span> →</button>
          </div>
        </Reveal>
        <Reveal className="fmap">
          <svg ref={svgRef} viewBox="0 0 600 360" role="img" aria-label={aria}>
            <path className="land" d={LAND} />
            {others.map((tw, i) => (
              <path
                key={tw.key}
                className={`route${drawn ? ' on' : ''}`}
                style={{ transitionDelay: `${0.2 + i * 0.22}s` }}
                d={`M${base.mapX} ${base.mapY} Q${(base.mapX + tw.mapX) / 2} ${Math.min(base.mapY, tw.mapY) - 70} ${tw.mapX} ${tw.mapY}`}
              />
            ))}
            {[base, ...others].map((tw) => {
              const isBase = tw === base;
              return (
                <g className="pin" key={tw.key}>
                  <circle className="halo" cx={tw.mapX} cy={tw.mapY} r={isBase ? 16 : 11} />
                  <circle cx={tw.mapX} cy={tw.mapY} r={isBase ? 11 : 7} fill={isBase ? '#121214' : '#E5BF24'} stroke="#fff" strokeWidth="3" />
                  <text x={tw.mapX + tw.label.dx} y={tw.mapY + tw.label.dy} textAnchor={tw.label.anchor}>
                    {tw.name}{isBase ? ' ★' : ''}
                  </text>
                </g>
              );
            })}
            <g ref={vanRef} transform="translate(-100 -100)">
              <rect x="-13" y="-10" width="17" height="11" rx="2" fill="#E5BF24" />
              <path d="M4 -7h5l4 4v4H4z" fill="#121214" />
              <circle cx="-8" cy="2" r="2.6" fill="#121214" />
              <circle cx="8" cy="2" r="2.6" fill="#121214" />
              <image href={mediaUrl('/media/logo/dfresh-icon.webp')} x="-11" y="-9" width="12" height="8" />
            </g>
          </svg>
        </Reveal>
      </div>
    </section>
  );
}
