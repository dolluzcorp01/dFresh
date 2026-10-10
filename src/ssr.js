// Server render of one public page: the entry of the Node bundle build-ssr/ssr.js (scripts/prerender.js).
// Used at build time (scripts/prerender.js writes every page per language) and by seo.js when the content
// changed since the build. The browser hydrates this HTML (src/index.js) with the same data, so the first
// screen paints before main.js has loaded. Only effects touch the browser: nothing rendered here reads window.
// prerenderToNodeStream (not renderToString) waits for lazy parts (the hero sheet), so every Suspense boundary
// is complete and hydrates without falling back to a client render.
import { StrictMode } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { StaticRouter } from 'react-router-dom/server';
import { AppRoutes, ROUTER_FUTURE } from './App';
import { primeContent } from './i18n/I18nProvider';

/** HTML inside <div id="root"> for url (path + optional ?cat=), with { languages, boot } as from the API. */
export async function renderPage(url, languages, boot) {
  primeContent(languages, boot);
  // React would render a failing part as an empty client-rendered boundary; a half page is never sent:
  // any error fails the render and seo.js serves the plain shell instead.
  const errors = [];
  const { prelude } = await prerenderToNodeStream(
    <StrictMode>
      <StaticRouter location={url} future={ROUTER_FUTURE}>
        <AppRoutes />
      </StaticRouter>
    </StrictMode>,
    { onError: (err) => { errors.push(err); } }
  );
  let html = '';
  for await (const chunk of prelude) html += chunk;
  if (errors.length) throw errors[0];
  return html;
}
