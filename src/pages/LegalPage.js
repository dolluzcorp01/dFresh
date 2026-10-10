// /:lang/privacy and /:lang/terms (spec E): title, the lg_en note when the body is the English fallback,
// then the English body from GET /legal/:page.
import { useI18n } from '../i18n/useT';
import useLegal from '../legal/useLegal';
import LegalBody from '../legal/LegalBody';
import { LEGAL_TITLES } from '../legal/legalPages';
import '../legal/Legal.css';

export default function LegalPage({ page }) {
  const { t, lang } = useI18n();
  const legal = useLegal(page, lang);
  return (
    <section className="sec legal-page" aria-labelledby="legal-h">
      <div className="wrap">
        <h1 id="legal-h">{legal.status === 'ok' ? legal.doc.title : t(LEGAL_TITLES[page])}</h1>
        <LegalBody legal={legal} />
      </div>
    </section>
  );
}
