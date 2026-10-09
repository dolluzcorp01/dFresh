// openForm(type, prefill?) from anywhere (header, menu, footer, sections, product cards). Phase 2: the modal
// shell with the form's title and subtitle; the fields, validation and submit arrive in Phase 6 (FormModal).
// prefill: e.g. { products: ['DZIND-DF008-BUR'] } from a card's "Request a quote" (that product ticked).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { useT } from '../i18n/useT';
import { track } from '../utils/track';

// form_type (docs/06_API.md) -> title / subtitle keys
const FORMS = {
  brochure: ['m_brochure', 'm_brochure_s'],
  quote: ['m_quote', 'm_quote_s'],
  sample: ['m_quote', 'm_quote_s'],
  distributor: ['m_dist', 'm_dist_s'],
  contact: ['m_contact', 'm_contact_s'],
};

const FormsContext = createContext(() => {});

export function useOpenForm() {
  return useContext(FormsContext);
}

export function FormsProvider({ children }) {
  const t = useT();
  const [{ form, prefill }, setState] = useState({ form: null, prefill: null });
  const openForm = useCallback((type, pre = null) => {
    if (!FORMS[type]) return;
    track('form_open', { form: type });
    setState({ form: type, prefill: pre });
  }, []);
  const close = useCallback(() => setState({ form: null, prefill: null }), []);
  const keys = form && FORMS[form];

  return (
    <FormsContext.Provider value={useMemo(() => openForm, [openForm])}>
      {children}
      <Modal open={Boolean(form)} onClose={close} title={keys ? t(keys[0]) : ''}>
        {keys && <p className="sub" data-prefill={prefill && prefill.products ? prefill.products.join(' ') : undefined}>{t(keys[1])}</p>}
      </Modal>
    </FormsContext.Provider>
  );
}
