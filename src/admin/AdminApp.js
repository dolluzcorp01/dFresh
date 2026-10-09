// Admin console (lazy chunk, staff only, noindex). Phase 2 placeholder; the console is Phase 7.
import { useEffect } from 'react';

export default function AdminApp() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    document.title = 'dFresh admin';
    return () => meta.remove();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>dFresh admin</h1>
      <p>Admin console - coming in Phase 7.</p>
    </main>
  );
}
