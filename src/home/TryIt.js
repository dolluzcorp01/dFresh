// Try it - two toys (spec B6): the roll and the napkin. When the section is first 35% visible the roll unrolls
// once (RollToy watches that itself) and the napkin starts its auto-cycle (preview "playOnce").
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import Reveal from '../components/Reveal';
import RollToy from './RollToy';
import NapkinSizer from './NapkinSizer';
import './TryIt.css';

function Hint() {
  const { t } = useI18n();
  return <span className="hint"><span>{t('tryit')}</span> ✦</span>;
}

export default function TryIt() {
  const { t } = useI18n();
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return undefined;
    if (!('IntersectionObserver' in window)) {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);

  return (
    <section className="sec play" id="play" ref={ref} aria-label={t('tryit')}>
      <div className="wrap duo">
        <Reveal className="tile t-roll">
          <Hint />
          <span className="k">{t('ur_k')}</span>
          <h3>{t('ur_h')}</h3>
          <p>{t('ur_p')}</p>
          <RollToy />
        </Reveal>
        <Reveal className="tile t-nap">
          <Hint />
          <span className="k">{t('fo_k')}</span>
          <h3>{t('fo_h')}</h3>
          <p>{t('fo_p')}</p>
          <NapkinSizer seen={seen} />
        </Reveal>
      </div>
    </section>
  );
}
