// Who it's for - two doors (spec B3): For Home -> products with the "For Home" filter (photo DZIND-DF028),
// For Business -> #business (photo DZIND-DF037).
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import { useOpenProducts } from '../products/useOpenProducts';
import { linkTarget } from '../components/navLinks';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import Reveal from '../components/Reveal';
import { productImage } from './productImage';
import './Doors.css';

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
  const { t, lang, data } = useI18n();
  const openProducts = useOpenProducts();

  const onHome = (e) => {
    e.preventDefault();
    openProducts({ filter: 'home' }, e.currentTarget);
  };

  return (
    <section className="sec doors" aria-labelledby="doors-h">
      <div className="wrap">
        <div className="sh">
          <Kicker>{t('doors_k')}</Kicker>
          <h2 id="doors-h">{t('doors_h')}</h2>
        </div>
        <div className="grid">
          <Reveal as={Link} className="door home" to={`/${lang}/products?cat=home`} onClick={onHome}>
            <div>
              <span className="k">{t('for_home')}</span>
              <h3>{t('dh_h')}</h3>
              <p>{t('dh_p')}</p>
            </div>
            <span className="go"><span>{t('dh_go')}</span><i aria-hidden="true">→</i></span>
            <Art img={productImage(data.products, HOME_ART)} />
          </Reveal>
          <Reveal as={Link} className="door biz" to={linkTarget(lang, { hash: 'business' })}>
            <div>
              <span className="k">{t('for_business')}</span>
              <h3>{t('db_h')}</h3>
              <p>{t('db_p')}</p>
            </div>
            <span className="go"><span>{t('db_go')}</span><i aria-hidden="true">→</i></span>
            <Art img={productImage(data.products, BIZ_ART)} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
