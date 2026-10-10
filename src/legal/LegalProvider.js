// openLegal('privacy' | 'terms') from anywhere (form consent links): the legal text in a modal ON TOP of
// whatever is open, so a half-filled form keeps its data. Esc / X closes only this layer (Modal stacks).
import { createContext, useCallback, useContext, useState } from 'react';
import Modal from '../components/Modal';
import { useI18n } from '../i18n/useT';
import { mediaUrl } from '../utils/api';
import useLegal from './useLegal';
import LegalBody from './LegalBody';
import { LEGAL_TITLES } from './legalPages';
import './Legal.css';

const LegalContext = createContext(() => {});

export function useOpenLegal() {
  return useContext(LegalContext);
}

function LegalModal({ page, onClose }) {
  const { t, lang } = useI18n();
  const legal = useLegal(page, lang);
  const title = legal.status === 'ok' ? legal.doc.title : t(LEGAL_TITLES[page]);
  return (
    <Modal open onClose={onClose} title={title} className="legal-m" before={<img className="mlogo" src={mediaUrl('/media/logo/dfresh-logo-on-light.webp')} alt="dFresh" width="900" height="498" />}>
      <LegalBody legal={legal} />
    </Modal>
  );
}

export function LegalProvider({ children }) {
  const [page, setPage] = useState(null);
  const openLegal = useCallback((p) => { if (LEGAL_TITLES[p]) setPage(p); }, []);
  return (
    <LegalContext.Provider value={openLegal}>
      {children}
      {page && <LegalModal page={page} onClose={() => setPage(null)} />}
    </LegalContext.Provider>
  );
}
