// Top-level routes. The admin console is a separate lazy chunk: it adds nothing to the public bundle.
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import PublicApp from './PublicApp';

const AdminApp = lazy(() => import(/* webpackChunkName: "admin" */ './admin/AdminApp'));

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/admin/*" element={<Suspense fallback={null}><AdminApp /></Suspense>} />
        <Route path="*" element={<PublicApp />} />
      </Routes>
    </BrowserRouter>
  );
}
