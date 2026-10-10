// Legal text (spec E) from GET /legal/:page?lang=xx, kept in memory per page + language.
// { status: 'loading' | 'ok' | 'error', doc: { title, html, isEnglishFallback }, retry }
import { useCallback, useEffect, useState } from 'react';
import { getJSON } from '../utils/api';

const cache = new Map();

export default function useLegal(page, lang) {
  const key = `${page}:${lang}`;
  const [state, setState] = useState(() => (cache.has(key) ? { status: 'ok', doc: cache.get(key) } : { status: 'loading' }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!page) return undefined;
    if (cache.has(key)) {
      setState({ status: 'ok', doc: cache.get(key) });
      return undefined;
    }
    let live = true;
    setState({ status: 'loading' });
    getJSON(`/api/dfresh/legal/${encodeURIComponent(page)}?lang=${encodeURIComponent(lang)}`)
      .then((doc) => {
        cache.set(key, doc);
        if (live) setState({ status: 'ok', doc });
      })
      .catch(() => { if (live) setState({ status: 'error' }); });
    return () => { live = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
