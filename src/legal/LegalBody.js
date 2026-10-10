// The body of a legal page: the lg_en note when the text is the English fallback, then the HTML from the API
// (sanitised on the server to p / h3 / h4 / ul / ol / li / br / em / strong, so it is safe to render).
import { useI18n } from '../i18n/useT';
import '../components/LoadState.css';
import { RetryIcon } from '../components/Icons';

export default function LegalBody({ legal }) {
  const { t } = useI18n();
  if (legal.status === 'loading') {
    return (
      <div className="legal-load" aria-busy="true">
        {[92, 70, 84, 56].map((w) => <i key={w} className="ls-bar" style={{ width: `${w}%` }} />)}
      </div>
    );
  }
  if (legal.status === 'error') {
    return (
      <div className="legal-err">
        <p>{t('load_err_p')}</p>
        <button type="button" className="btn b-ink b-sm" onClick={legal.retry}><RetryIcon />{t('retry')}</button>
      </div>
    );
  }
  const note = legal.doc.isEnglishFallback && t('lg_en');
  return (
    <>
      {note && <p className="sub">{note}</p>}
      {/* eslint-disable-next-line react/no-danger */}
      <div className="legaltxt" lang="en" dangerouslySetInnerHTML={{ __html: legal.doc.html }} />
    </>
  );
}
