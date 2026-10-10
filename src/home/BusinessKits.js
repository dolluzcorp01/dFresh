// For Business - kits accordion (spec B7). One kit open at a time. Desktop with a mouse: the kit under the
// pointer opens after a short intent delay (70 ms, and never sooner than 300 ms after the last change), so
// sweeping across does not flicker. Touch, keyboard and small screens: tap / Enter / Space on the kit.
// Open kit: number, rep photo, name, tagline, its products, WhatsApp (wa_kit with ids + names) and
// "free sample" -> the quote form in sample mode with the kit's products and business type filled in.
// Accessible accordion pattern: each kit name is a heading holding the expand button; closed panels are inert.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import { useOpenForm } from '../forms/FormsProvider';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import { productImage } from './productImage';
import './BusinessKits.css';

const HOVER = '(hover: hover) and (min-width: 821px)';
const INTENT_MS = 70;
const LOCK_MS = 300;

export default function BusinessKits() {
  const { t, data, settings } = useI18n();
  const openForm = useOpenForm();
  const kits = data.kits;
  const [open, setOpen] = useState(0);
  const accRef = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  // hover intent (preview renderAcc): decide from the element under the pointer when the timer fires
  useEffect(() => {
    const acc = accRef.current;
    if (!acc) return undefined;
    let timer = 0;
    let want = -1;
    let lockUntil = 0;
    let px = 0;
    let py = 0;
    const pick = () => {
      want = -1;
      const el = document.elementFromPoint(px, py);
      const card = el && el.closest('.ac');
      if (card && acc.contains(card)) {
        const k = Number(card.dataset.ac);
        if (k !== openRef.current) {
          lockUntil = performance.now() + LOCK_MS;
          setOpen(k);
        }
      }
    };
    const onMove = (e) => {
      if (e.pointerType !== 'mouse' || !window.matchMedia(HOVER).matches) return;
      px = e.clientX;
      py = e.clientY;
      const card = e.target.closest('.ac');
      const k = card ? Number(card.dataset.ac) : -1;
      if (k < 0 || k === openRef.current) {
        clearTimeout(timer);
        want = -1;
        return;
      }
      if (k === want) return;
      want = k;
      clearTimeout(timer);
      timer = setTimeout(pick, Math.max(INTENT_MS, lockUntil - performance.now()));
    };
    const onLeave = () => {
      clearTimeout(timer);
      want = -1;
    };
    acc.addEventListener('pointermove', onMove);
    acc.addEventListener('pointerleave', onLeave);
    return () => {
      clearTimeout(timer);
      acc.removeEventListener('pointermove', onMove);
      acc.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const byId = new Map(data.products.map((p) => [p.id, p]));

  return (
    <section className="sec biz" id="business" aria-labelledby="biz-h">
      <div className="wrap">
        <div className="sh">
          <Kicker>{t('for_business')}</Kicker>
          <h2 id="biz-h">{t('biz_h')}</h2>
          <p>{t('biz_p')}</p>
        </div>
        <div className="acc" ref={accRef}>
          {kits.map((kit, i) => {
            const on = i === open;
            const items = kit.products.map((id) => byId.get(id)).filter(Boolean);
            const img = productImage(data.products, kit.repProductId);
            const msg = t('wa_kit', { kit: kit.name, items: items.map((p) => `${p.id} ${p.name}`).join(', ') });
            const panel = `kit-${kit.key}`;
            return (
              // a click anywhere on a closed kit opens it (mouse / touch); keyboard uses the heading button
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <div key={kit.key} className={`ac${on ? ' open' : ''}`} data-ac={i} onClick={(e) => { if (!e.target.closest('a, button')) setOpen(i); }}>
                <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                {img && (
                  <div className="im">
                    <img className="ph" src={mediaUrl(img.src)} srcSet={mediaSrcSet(img.srcset)} sizes="(max-width: 820px) 110px, 190px"
                      width={img.width || undefined} height={img.height || undefined} alt="" loading="lazy" decoding="async" draggable="false" />
                  </div>
                )}
                <h3>
                  <button type="button" className="ac-t" aria-expanded={on} aria-controls={panel} onClick={() => setOpen(i)}>{kit.name}</button>
                </h3>
                <div className="more" id={panel} inert={!on}>
                  <div>
                    <p>{kit.tagline}</p>
                    <ul>{items.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
                    <div className="acts">
                      <a className={`btn b-sm ${i % 4 === 1 ? 'b-gold' : 'b-ink'}`} href={waHref(settings.whatsapp_number, msg)} target="_blank" rel="noopener noreferrer"
                        onClick={() => trackWhatsApp(kit.key, 'kits')}>
                        {t('kit_cta')} →
                      </a>
                      <button type="button" className="btn b-sm b-line" onClick={() => openForm('sample', { products: kit.products, businessType: kit.businessType, ref: kit.key })}>
                        {t('sample')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
