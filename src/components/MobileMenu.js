// Menu sheet for the compact header (spec A1). Closes on link tap, outside tap, Esc, and when the header
// leaves compact mode (resize above 900px with room for the full nav).
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { useOpenForm } from '../forms/FormsProvider';
import { MAIN_LINKS, linkTarget } from './navLinks';

export default function MobileMenu({ id, open, onClose, buttonRef, compact }) {
  const { lang, t } = useI18n();
  const openForm = useOpenForm();
  const ref = useRef(null);

  useEffect(() => {
    if (!compact) onClose();
  }, [compact, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current.contains(e.target) || buttonRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      onClose();
      buttonRef.current.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, buttonRef]);

  const form = (type) => () => {
    onClose();
    openForm(type);
  };

  return (
    <nav id={id} ref={ref} className="msheet" aria-label={t('menu')} hidden={!open}>
      {MAIN_LINKS.map((l) => (
        <Link key={l.key} to={linkTarget(lang, l)} onClick={onClose}>{t(l.key)}</Link>
      ))}
      <button type="button" onClick={form('quote')}>{t('request_quote')}</button>
      <button type="button" onClick={form('distributor')}>{t('become_distributor')}</button>
    </nav>
  );
}
