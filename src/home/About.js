// About (spec B9): ab_k / ab_h / ab_p, the "about" banner photo (framed to the right so the product shows)
// and three points ab1-ab3. The photo is the about banner's desktop file while that banner is active.
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import Reveal from '../components/Reveal';
import { mediaUrl } from '../utils/api';
import './About.css';

const POINTS = [['ab1', '\u{1F33F}'], ['ab2', '\u{1F4E6}'], ['ab3', '✔']]; // decorative icons

export default function About() {
  const { t, data } = useI18n();
  const photo = data.banners.find((b) => b.key === 'about');

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
            {photo && <img src={mediaUrl(photo.desktop)} alt={t('ab_alt')} width="1920" height="800" loading="lazy" decoding="async" draggable="false" />}
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
