// Try it: the napkin (spec B6). Size buttons from size_picker; picking one unfolds the napkin (two folds open,
// then a little settle), scales it to that size, counts the size up / down and shows the matching product.
// Auto-cycles every 2.6 s from when the section is first seen until the visitor picks a size; the cycle pauses
// off screen / in a hidden tab. Reduced motion: no auto-cycle, no animation, the size just changes.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import { mediaUrl } from '../utils/api';
import { watchActive } from '../utils/loop';
import { track } from '../utils/track';
import useReducedMotion from '../utils/useReducedMotion';

const CYCLE_MS = 2600;
const nums = (label) => (String(label).match(/\d+/g) || ['0']).map(Number);

export default function NapkinSizer({ seen }) {
  const { t, data } = useI18n();
  const reduced = useReducedMotion();
  const sizes = data.sizePicker;
  const [i, setI] = useState(() => Math.max(0, sizes.findIndex((s) => s.isDefault)));
  const [auto, setAuto] = useState(true);
  const boxRef = useRef(null);
  const wrapRef = useRef(null);
  const q2Ref = useRef(null);
  const q3Ref = useRef(null);
  const outRef = useRef(null);
  const prev = useRef(i);
  const cur = sizes[i] || sizes[0];

  // unfold + count whenever the size changes (not on first paint)
  useEffect(() => {
    const from = sizes[prev.current];
    prev.current = i;
    const out = outRef.current;
    if (!cur || !out) return undefined;
    if (!from || from === cur || reduced || !Element.prototype.animate) {
      out.textContent = cur.size;
      return undefined;
    }
    const a = nums(from.size);
    const b = nums(cur.size);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 600);
      const e = 1 - (1 - k) ** 3;
      out.textContent = b.map((v, j) => Math.round((a[j] ?? v) + (v - (a[j] ?? v)) * e)).join('×');
      if (k < 1) raf = requestAnimationFrame(tick);
      else out.textContent = cur.size;
    };
    raf = requestAnimationFrame(tick);
    const anims = [
      q2Ref.current.animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0)' }], { duration: 450, easing: 'ease-in-out' }),
      q3Ref.current.animate([{ transform: 'rotateX(180deg)' }, { transform: 'rotateX(0)' }], { duration: 450, delay: 450, easing: 'ease-in-out', fill: 'backwards' }),
      wrapRef.current.animate([{ rotate: '-8deg' }, { rotate: '0deg' }], { duration: 500, delay: 450, easing: 'cubic-bezier(.3,1.8,.5,1)' }),
    ];
    return () => {
      cancelAnimationFrame(raf);
      anims.forEach((an) => an.finish());
    };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-cycle: from first sight until the visitor picks, only while on screen and the tab is visible
  useEffect(() => {
    if (!seen || !auto || reduced || sizes.length < 2) return undefined;
    let timer = 0;
    const stop = watchActive(boxRef.current, (active) => {
      clearInterval(timer);
      if (active) timer = setInterval(() => setI((x) => (x + 1) % sizes.length), CYCLE_MS);
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [seen, auto, reduced, sizes.length]);

  if (!cur) return null;
  const product = data.products.find((p) => p.id === cur.productId);

  const pick = (k) => {
    setAuto(false);
    setI(k);
    track('size_pick', { size: sizes[k].size });
  };

  return (
    <div ref={boxRef}>
      <div className="napbox">
        <div className="nap">
          <div className="wrapN" ref={wrapRef} style={{ transform: `scale(${cur.scale})` }}>
            <div className="q q3" ref={q3Ref} />
            <div className="q q2" ref={q2Ref} />
            <div className="q q1" />
            <div className="emb"><img src={mediaUrl('/media/logo/dfresh-icon.webp')} alt="" width="26" height="17" draggable="false" /></div>
          </div>
        </div>
        <div className="szr">
          {/* the number is written by the effect above (it counts), never by React */}
          <b><span ref={outRef} /><small>{t('unit_cm')}</small></b>
          <div className="pn">{product ? `${product.id} · ${product.name}` : cur.productId}</div>
        </div>
      </div>
      <div className="szb" role="group" aria-label={t('size_aria')}>
        {sizes.map((s, k) => (
          <button key={s.pos} type="button" aria-pressed={k === i} onClick={() => pick(k)}>{s.size}</button>
        ))}
      </div>
    </div>
  );
}
