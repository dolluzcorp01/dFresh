import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';
import { prefetchContent } from './i18n/I18nProvider';
import reportWebVitals from './reportWebVitals';

prefetchContent(window.location.pathname);

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
  setTimeout(hydrate, 300);
} else {
  ReactDOM.createRoot(container).render(app);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
