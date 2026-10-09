// Hosts the products drawer as an overlay route (see useOpenProducts). Keeps the drawer mounted while its
// close circle runs, also when the visitor closed it with browser Back.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ProductsDrawer from './ProductsDrawer';

export default function ProductsOverlay({ active }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [kept, setKept] = useState(null);
  if (active && kept !== location) setKept(location); // remember the last open state for the close animation
  const loc = active ? location : kept;
  if (!loc) return null;

  const cat = new URLSearchParams(loc.search).get('cat') || '';
  const close = () => {
    const idx = window.history.state && window.history.state.idx;
    if (idx > 0) navigate(-1);
    else navigate(loc.state.bg, { replace: true }); // opened in a fresh tab: no page behind it in history
  };
  const onCat = (key) => navigate(
    { pathname: loc.pathname, search: key === 'all' ? '' : `?cat=${encodeURIComponent(key)}` },
    { replace: true, state: loc.state }
  );

  return (
    <ProductsDrawer
      key={loc.state.openId}
      open={active}
      origin={loc.state.origin}
      cat={cat}
      onCat={onCat}
      onClose={close}
      onExited={() => setKept(null)}
    />
  );
}
