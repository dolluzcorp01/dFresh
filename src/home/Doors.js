// Who it's for - two doors (spec B3). Phase 24: where each door goes is Website > Home page > Home doors, picked from
// the banner button list (Settings door_home_action / _target, door_biz_action / _target; these defaults are today's:
// For Home -> products with the "For Home" filter, For Business -> #business). Photos: DZIND-DF028 / DZIND-DF037.
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import { actionTo, useRunAction } from '../components/siteAction';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import Reveal from '../components/Reveal';
import { productImage } from './productImage';
import './Doors.css';

// Which product's first photo each door shows: Settings door_home_product / door_biz_product (these are the defaults).
const HOME_ART = 'DZIND-DF028';
const BIZ_ART = 'DZIND-DF037';

function Art({ img }) {
  if (!img) return null;
  return (
    <div className="art">
      <img
        className="ph"
        src={mediaUrl(img.src)}
        srcSet={mediaSrcSet(img.srcset)}
        sizes="(max-width: 760px) 86px, 190px"
        width={img.width || undefined}
        height={img.height || undefined}
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
      />
    </div>
  );
}

export default function Doors() {
  const { t, lang, data, settings } = useI18n();
  const run = useRunAction();
  const door = (which, action, target) => {
    const a = settings[`door_${which}_action`] || action;
    const tg = settings[`door_${which}_action`] ? settings[`door_${which}_target`] || '' : target;
    return { to: actionTo(lang, a, tg), onClick: (e) => run(e, a, tg, `door_${which}`) };
  };
  const home = door('home', 'products_home', '');
  const biz = door('biz', 'section', 'business');

  return (
    <section className="sec doors" aria-labelledby="doors-h">
      <div className="wrap">
        <div className="sh">
          <Kicker>{t('doors_k')}</Kicker>
          <h2 id="doors-h">{t('doors_h')}</h2>
        </div>
        <div className="grid">
          <Reveal as={Link} className="door home" to={home.to} onClick={home.onClick}>
            <div>
              <span className="k">{t('for_home')}</span>
              <h3>{t('dh_h')}</h3>
              <p>{t('dh_p')}</p>
            </div>
            <span className="go"><span>{t('dh_go')}</span><i aria-hidden="true">→</i></span>
            <Art img={productImage(data.products, settings.door_home_product || HOME_ART)} />
          </Reveal>
          <Reveal as={Link} className="door biz" to={biz.to} onClick={biz.onClick}>
            <div>
              <span className="k">{t('for_business')}</span>
              <h3>{t('db_h')}</h3>
              <p>{t('db_p')}</p>
            </div>
            <span className="go"><span>{t('db_go')}</span><i aria-hidden="true">→</i></span>
            <Art img={productImage(data.products, settings.door_biz_product || BIZ_ART)} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
