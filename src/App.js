// Top-level routes. The admin console is a separate lazy chunk: it adds nothing to the public bundle.
// AppRoutes is shared with the server render (src/ssr.js), which wraps it in a StaticRouter instead of the
// BrowserRouter: the same tree on both sides, so the browser can hydrate the server's HTML.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import PublicApp from './PublicApp';

const AdminApp = lazy(() => import(/* webpackChunkName: "admin" */ './admin/AdminApp'));

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/admin/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
      <Route path="*" element={<PublicApp />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      <AppRoutes />
    </BrowserRouter>
  );
}
