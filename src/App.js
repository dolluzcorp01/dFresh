// TEMPORARY (Phase 0): proves the React app can reach the API. Replaced by the real site in Phase 2.
import { useEffect, useState } from 'react';
import { apiFetch } from './utils/api';

function App() {
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiFetch('/api/dfresh/health')
      .then((res) => res.json())
      .then(setResult)
      .catch((err) => setResult({ success: false, message: err.message }));
  }, []);

  return (
    <pre style={{ margin: 16, fontSize: 14, whiteSpace: 'pre-wrap' }} data-testid="health">
      {result ? JSON.stringify(result, null, 2) : '...'}
    </pre>
  );
}

export default App;
