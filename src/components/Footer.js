// Dark footer (spec A3). The big letters are static here; the spring "lift near the pointer" lands in Phase 5.
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { useOpenForm } from '../forms/FormsProvider';
import { mediaUrl } from '../utils/api';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import { MAIN_LINKS, linkTarget } from './navLinks';
import './Footer.css';

const SHOP_LINKS = [...MAIN_LINKS.slice(0, 3), { key: 'f_range', hash: 'range' }, MAIN_LINKS[3]];
const WORK_FORMS = [
  { key: 'request_quote', form: 'quote' },
  { key: 'become_distributor', form: 'distributor' },
  { key: 'download_brochure', form: 'brochure' },
];
const WORDMARK = 'dFresh'; // decorative artwork (aria-hidden), like the logo image

export default function Footer() {
  const { lang, t, settings } = useI18n();
  const openForm = useOpenForm();
  const legal = settings.gstin
    ? t('legal1_gst', { cin: settings.cin, gstin: settings.gstin })
    : t('legal1');

  return (
    <footer className="dark">
      <div className="wrap">
        <div>
          <img className="flogo" src={mediaUrl('/media/logo/dfresh-logo-on-dark.webp')} alt="dFresh" width="900" height="498" loading="lazy" />
          <img className="ftag" src={mediaUrl('/media/logo/dfresh-tagline.webp')} alt={t('tagline')} width="900" height="150" loading="lazy" />
          <p className="bl">{t('brand_line')}</p>
        </div>
        <div>
          <h4>{t('f_shop')}</h4>
          <ul>
            {SHOP_LINKS.map((l) => (
              <li key={l.key}><Link to={linkTarget(lang, l)}>{t(l.key)}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h4>{t('f_work')}</h4>
          <ul>
            {WORK_FORMS.map((f) => (
              <li key={f.key}><button type="button" className="lnk" onClick={() => openForm(f.form)}>{t(f.key)}</button></li>
            ))}
          </ul>
        </div>
        <div>
          <h4>{t('f_visit')}</h4>
          <ul>
            <li>
              {t('lbl_whatsapp')}:{' '}
              <a className="g" href={waHref(settings.whatsapp_number, t('wa_general'))} target="_blank" rel="noopener noreferrer"
                onClick={() => trackWhatsApp('general', 'footer')}>
                {settings.whatsapp_display}
              </a>
            </li>
            <li>{t('lbl_office')}: <a href={`tel:${String(settings.office_phone).replace(/[^\d+]/g, '')}`}>{settings.office_phone}</a></li>
            <li><a href={`mailto:${settings.public_email}`}>{settings.public_email}</a></li>
            <li>{t('f_addr')}</li>
          </ul>
        </div>
        <div className="legal">
          <span>{legal}</span>
          <span>
            {t('copyright', { year: new Date().getFullYear() })} · <Link to={`/${lang}/privacy`}>{t('lg_priv')}</Link> · <Link to={`/${lang}/terms`}>{t('lg_terms')}</Link>
          </span>
        </div>
      </div>
      <div className="bigf" aria-hidden="true">
        {[...WORDMARK].map((ch, i) => <span key={i}>{ch}</span>)}
      </div>
    </footer>
  );
}
