// GA4 events (spec A6). Silent until initAnalytics() gets a measurement id from site_settings;
// gtag.js is only loaded when one exists. Every event carries the current `language`.
// WhatsApp clicks: { item: product id | kit key | 'general', location }.
let measurementId = '';
let language = '';

export function initAnalytics(id) {
  if (measurementId || !/^G-[A-Z0-9]+$/.test(id || '')) return;
  measurementId = id;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments); // gtag.js reads the arguments object, not an array
  };
  window.gtag('js', new Date());
  window.gtag('config', id);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

export function setTrackLanguage(code) {
  language = code;
}

export function track(name, params = {}) {
  if (!measurementId) return;
  window.gtag('event', name, { ...params, language });
}
