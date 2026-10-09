# Phase 2 - Frontend shell (routing, i18n, layout, global behaviour)

Read first: docs/04_I18N.md, docs/05_FEATURES_SPEC.md sections A1-A6, the preview (open it in a browser).

## Goal
Language-prefixed routing and the global frame: header, mobile menu, footer, WhatsApp button, design tokens,
fonts per language, content protection, analytics helper, modal shell, reveal-on-scroll. Sections are placeholders.

## Steps
1. `src/styles/tokens.css` + `base.css`: port the preview's `:root` tokens and base rules (logical properties for RTL).
2. Routing: `/` -> saved / browser / default language; `/:lang`, `/:lang/products`, `/:lang/privacy`, `/:lang/terms`,
   `/admin/*` (placeholder, lazy). Invalid lang -> default with same path.
3. `I18nProvider` + `useT()` (placeholders `{n}`), loads `/languages` then `/bootstrap`, sets `<html lang dir>`,
   loads the language font from Google Fonts on demand, saves `dfresh-lang`, caches bootstraps per language.
4. Header (A1) incl. mobile menu sheet, LanguageSwitch (keeps path + query + hash), Footer (A3 incl. spring letters
   can be a stub until Phase 3), WhatsAppFab (A2), `track()` (A6, loads gtag only when a GA4 id exists),
   `protect.js` (A4), `useReducedMotion`, `Reveal` component (A5), `Modal` (focus trap, Esc, return focus, stacking).
5. Loading state: brand-coloured skeleton, no layout jump. Error state: friendly retry with WhatsApp button.

## Acceptance (show real output / screenshots at 1440 and 390 wide, EN + TA)
- Switching EN -> TA -> HI changes every header/footer text and `<html lang>`; reload keeps the language; URL prefix changes.
- `/xx/products` redirects to `/en/products`. Mobile menu opens/closes (tap outside, Esc, link).
- Right-click / copy blocked on text, allowed in a test input. No horizontal scroll at 360px.
- Public JS bundle does not include admin code (check the build output chunk list).

Commit: `phase 2: frontend shell - routing, i18n, layout`. Move file to done/, STOP.
