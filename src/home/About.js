// About (spec B9): ab_k / ab_h / ab_p, a photo (framed to the right so the product shows)
// and three points ab1-ab3. The photo is site setting `about_image` (a path under /media), independent of the
// "about" banner, so the banner can be switched off without losing the photo. Empty = no photo.
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import Reveal from '../components/Reveal';
import { mediaUrl } from '../utils/api';
import './About.css';

// 'banners/desktop/x.webp' -> '/media/banners/desktop/x.webp'; anything that could leave /media is ignored.
function mediaPath(value) {
  const parts = String(value || '').trim().replace(/^\/+/, '').replace(/^media\//, '').split('/');
  if (!parts[0] || parts.some((p) => !p || p === '.' || p === '..')) return null;
  return `/media/${parts.map(encodeURIComponent).join('/')}`;
}

const POINTS = [['ab1', '\u{1F33F}'], ['ab2', '\u{1F4E6}'], ['ab3', '✔']]; // decorative icons

export default function About() {
  const { t, data } = useI18n();
  const photo = mediaPath(data.settings.about_image);

  return (
    <section className="sec about" id="about" aria-labelledby="about-h">
      <div className="wrap">
        <div className="ab">
          <Reveal className="txt">
            <Kicker>{t('ab_k')}</Kicker>
            <h2 id="about-h">{t('ab_h')}</h2>
            <p>{t('ab_p')}</p>
          </Reveal>
          <Reveal className="pic">
            {photo && <img src={mediaUrl(photo)} alt={t('ab_alt')} width="1920" height="800" loading="lazy" decoding="async" draggable="false" />}
          </Reveal>
        </div>
        <div className="pts">
          {POINTS.map(([k, icon]) => (
            <Reveal key={k} className="pt">
              <i aria-hidden="true">{icon}</i>
              <b>{t(`${k}_h`)}</b>
              <p>{t(`${k}_p`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
