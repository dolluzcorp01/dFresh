// /:lang/privacy and /:lang/terms. Phase 2 placeholder (title only); the body from /legal is Phase 5.
import { useT } from '../i18n/useT';

const TITLES = { privacy: 'lg_priv', terms: 'lg_terms_h' };

export default function LegalPage({ page }) {
  const t = useT();
  return (
    <section className="sec">
      <div className="wrap sh left">
        <h2>{t(TITLES[page])}</h2>
      </div>
    </section>
  );
}
