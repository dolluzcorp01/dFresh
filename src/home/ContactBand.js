// Contact band (spec B10): big headline over a soft breathing yellow blob, buttons (free sample = quote form
// in sample mode, WhatsApp, brochure, message), the numbers line, and two visit cards with a lazy Google map
// (the map_load text sits underneath until it paints) and an "Open in Google Maps" link, both from the
// office_map_query / godown_map_query settings. On hover devices the sample and WhatsApp buttons throw a
// little paper confetti (at most every 1.5 s each), as in the preview.
import { useI18n } from '../i18n/useT';
import Reveal from '../components/Reveal';
import { useOpenForm } from '../forms/FormsProvider';
import { WhatsAppIcon } from '../components/Icons';
import { burst } from '../utils/burst';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import './ContactBand.css';

const embedUrl = (q) => `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;

const lastBurst = new WeakMap();
function confetti(e) {
  if (e.pointerType !== 'mouse') return;
  const b = e.currentTarget;
  const now = performance.now();
  if (now - (lastBurst.get(b) || -1e9) < 1500) return;
  lastBurst.set(b, now);
  const r = b.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top, 10);
}

function Visit({ name, address, query }) {
  const { t } = useI18n();
  return (
    <Reveal className="vc">
      <div className="mapf">
        <span>{t('map_load')}</span>
        {query && <iframe title={t('map_frame', { place: name })} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={embedUrl(query)} />}
      </div>
      <div className="vb">
        <b>{name}</b>
        <p>{address}</p>
        {query && <a className="btn b-ink b-sm" href={mapsUrl(query)} target="_blank" rel="noopener noreferrer"><span>{t('c_map')}</span> →</a>}
      </div>
    </Reveal>
  );
}

export default function ContactBand() {
  const { t, settings } = useI18n();
  const openForm = useOpenForm();

  return (
    <section className="sec cta" id="contact" aria-labelledby="band-h">
      <div className="blob" aria-hidden="true" />
      <div className="wrap">
        <h2 id="band-h">{t('band_h')}</h2>
        <p>{t('band_p')}</p>
        <div className="acts">
          <button type="button" className="btn b-ink" onPointerEnter={confetti} onClick={() => openForm('sample')}><span>{t('sample')}</span> →</button>
          <a className="btn b-wa" href={waHref(settings.whatsapp_number, t('wa_general'))} target="_blank" rel="noopener noreferrer"
            onPointerEnter={confetti} onClick={() => trackWhatsApp('general', 'contact')}>
            <WhatsAppIcon /><span>{t('whatsapp_us')}</span>
          </a>
          <button type="button" className="btn b-white" onClick={() => openForm('brochure')}><span>{t('download_brochure')}</span> ↓</button>
          <button type="button" className="btn b-line" onClick={() => openForm('contact')}>{t('msg_btn')}</button>
        </div>
        <div className="nums">
          <span>{t('lbl_whatsapp')} · <a href={waHref(settings.whatsapp_number, t('wa_general'))} target="_blank" rel="noopener noreferrer" onClick={() => trackWhatsApp('general', 'contact_numbers')}><b>{settings.whatsapp_display}</b></a></span>
          <span>{t('lbl_office')} · <a href={tel(settings.office_phone)}><b>{settings.office_phone}</b></a></span>
          <span><a href={`mailto:${settings.public_email}`}><b>{settings.public_email}</b></a></span>
        </div>
        <div className="visit">
          <Visit name={t('c_office')} address={t('c_office_a')} query={settings.office_map_query} />
          <Visit name={t('c_godown')} address={t('c_godown_a')} query={settings.godown_map_query} />
        </div>
      </div>
    </section>
  );
}
