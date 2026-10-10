// openForm(type, prefill?) from anywhere (header, menu, footer, sections, product cards) -> FormModal.
// prefill: e.g. { products: ['DZIND-DF008-BUR'], ref: 'DZIND-DF008-BUR' } from a card's "Request a quote"
// (that product ticked), or { products: [...kit ids], businessType: 'hotel', ref: 'hotels' } from a kit's
// "free sample" (form 'sample'). ref = the product or kit that opened it (leads.source_ref); the page and
// section are recorded too (leads.source_page). Every open mounts a fresh form.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { track } from '../utils/track';
import FormModal from './FormModal';
import { FORM_TYPES } from './formConfig';

const FormsContext = createContext(() => {});

export function useOpenForm() {
  return useContext(FormsContext);
}

export function FormsProvider({ children }) {
  const [state, setState] = useState(null); // { type, prefill, source, n }
  const openForm = useCallback((type, prefill = null) => {
    if (!FORM_TYPES.includes(type)) return;
    track('form_open', { form: type });
    const source = {
      page: `${window.location.pathname}${window.location.hash}`.slice(0, 150),
      ref: prefill && typeof prefill.ref === 'string' ? prefill.ref : null,
    };
    setState((s) => ({ type, prefill, source, n: (s ? s.n : 0) + 1 }));
  }, []);
  const close = useCallback(() => setState(null), []);

  return (
    <FormsContext.Provider value={useMemo(() => openForm, [openForm])}>
      {children}
      {state && <FormModal key={state.n} type={state.type} prefill={state.prefill} source={state.source} onClose={close} />}
    </FormsContext.Provider>
  );
}
