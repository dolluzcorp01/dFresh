import { createContext, useContext } from 'react';

export const LanguagesContext = createContext(null);
export const I18nContext = createContext(null);

// { languages, default } from /languages
export function useLanguages() {
  return useContext(LanguagesContext);
}

// { lang, info, data (bootstrap), settings, t }
export function useI18n() {
  return useContext(I18nContext);
}

// t('know_more'), t('n_products', { n: 7 })
export function useT() {
  return useContext(I18nContext).t;
}
