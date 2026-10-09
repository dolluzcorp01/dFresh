// Product flip card (spec C1), used in the featured rail and the products drawer.
// Front: photo carousel + spec slide, ID chip, name, one-liner, 3 keyword chips, colour swatches, Know more.
// Back: ID chip, name, description, spec / pack / best for, WhatsApp, Request a quote, Back.
// One card flipped page-wide (store.js); focus moves to Back on flip and returns to Know more on unflip;
// the hidden face is inert. A picked colour swaps every text field, photos and the WhatsApp message.
import { useEffect, useId, useRef } from 'react';
import { useI18n } from '../i18n/useT';
import { useOpenForm } from '../forms/FormsProvider';
import { WhatsAppIcon } from '../components/Icons';
import { track } from '../utils/track';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import { setFlipped, setVariantChoice, useFlipped, useVariantChoice } from './store';
import ProductCarousel from './ProductCarousel';
import './FlipCard.css';

// The card as shown: the parent row, or the picked variant's row over it (photos fall back to the parent's).
export function resolveVariant(p, choice) {
  const v = choice && p.variants.find((x) => x.id === choice);
  if (!v) return p;
  return { ...p, ...v, images: v.images && v.images.length ? v.images : p.images };
}

export default function FlipCard({ product: p, index = 0 }) {
  const { t, settings } = useI18n();
  const openForm = useOpenForm();
  const key = useId();
  const flipped = useFlipped(key);
  const choice = useVariantChoice(p.id);
  const d = resolveVariant(p, choice);
  const kmRef = useRef(null);
  const backRef = useRef(null);
  const focusNext = useRef(null); // 'back' | 'km' after a flip the visitor asked for

  useEffect(() => {
    const el = focusNext.current === 'back' ? backRef.current : focusNext.current === 'km' ? kmRef.current : null;
    focusNext.current = null;
    if (el) el.focus({ preventScroll: true });
  }, [flipped]);

  useEffect(() => () => setFlipped(key, false), [key]); // a card that leaves (drawer closed) is not flipped

  const flip = (on) => {
    focusNext.current = on ? 'back' : 'km';
    setFlipped(key, on);
    if (on) track('card_flip', { product_id: d.id });
  };

  const pick = (id) => {
    const next = id === p.id ? '' : id;
    if (next === choice) return;
    setVariantChoice(p.id, next);
    track('variant_pick', { product_id: id });
  };

  const swatches = p.variants.length ? [p, ...p.variants] : [];

  return (
    <article className={`card${flipped ? ' flipped' : ''}`} data-id={p.id}>
      <div className="card-in">
        <div className="face front" aria-hidden={flipped} inert={flipped}>
          <ProductCarousel product={d} index={index} paused={flipped} />
          <div className="fb">
            <span className="idc">{d.id}</span>
            <h3>{d.name}</h3>
            <p className="one">{d.oneLiner}</p>
            <div className="chips">
              {d.keywords.slice(0, 3).map((k) => <span key={k}>{k}</span>)}
            </div>
            {swatches.length > 0 && (
              <div className="sw" role="group" aria-label={t('colour')}>
                <span>{t('colour')}:</span>
                {swatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={s.id === d.id}
                    aria-label={s.colourName}
                    title={s.colourName}
                    style={{ '--c': s.swatch }}
                    onClick={() => pick(s.id)}
                  />
                ))}
                <b className="swn">{d.colourName}</b>
              </div>
            )}
            <button ref={kmRef} className="km" type="button" aria-expanded={flipped} onClick={() => flip(true)}>
              {t('know_more')} <i aria-hidden="true">↻</i>
            </button>
          </div>
        </div>
        <div className="face back" aria-hidden={!flipped} inert={!flipped}>
          <span className="idc">{d.id}</span>
          <h3>{d.name}</h3>
          <p className="desc">{d.description}</p>
          <dl className="spec">
            <dt>{t('specifications')}</dt><dd>{d.spec}</dd>
            <dt>{t('pack')}</dt><dd>{d.pack}</dd>
            <dt>{t('best_for')}</dt><dd>{d.bestFor}</dd>
          </dl>
          <div className="bb">
            <a
              className="btn b-wa b-sm"
              href={waHref(settings.whatsapp_number, d.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackWhatsApp(d.id, 'card')}
            >
              <WhatsAppIcon /> {t('lbl_whatsapp')}
            </a>
            <button className="btn b-ink b-sm" type="button" onClick={() => openForm('quote', { products: [d.id] })}>
              {t('request_quote')}
            </button>
            <button ref={backRef} className="bk" type="button" onClick={() => flip(false)}>
              <span aria-hidden="true">←</span> {t('back')}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
