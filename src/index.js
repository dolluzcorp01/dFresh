import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';
import { prefetchContent } from './i18n/I18nProvider';
import reportWebVitals from './reportWebVitals';

prefetchContent(window.location.pathname);

// A #section in the URL on load (shared link, reload): the browser must not restore an old scroll position or glide
// on its own; every home section renders at its real height at once; HomePage lands on the section in one move
// (utils/scrollToSection.js), then smooth scrolling comes back.
if (window.location.hash) {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  document.documentElement.classList.add('hash-load');
}

// The server sends public pages already rendered (src/ssr.js): hydrate that HTML instead of painting again.
// Hydration waits until the browser has painted the server HTML (the frame after this one; a timer as well in
// case a hidden tab never paints), so the first screen never waits for it. Clicks in between are replayed by
// React. Admin pages and the plain shell (dev server, "/") arrive empty and render here as before.
const container = document.getElementById('root');
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
if (container.firstElementChild) {
  let started = false;
  const hydrate = () => {
    if (started) return;
    started = true;
    ReactDOM.hydrateRoot(container, app);
  };
  requestAnimationFrame(() => setTimeout(hydrate, 0));
  setTimeout(hydrate, 50);
} else {
  ReactDOM.createRoot(container).render(app);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
