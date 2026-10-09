// /:lang/products opened directly (shared link, reload, search engine): the products drawer as the page,
// without the circle animation; X goes to the home page. Inside the site the same drawer opens as an
// overlay instead (ProductsOverlay).
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import ProductsDrawer from '../products/ProductsDrawer';

export default function ProductsPage() {
  const { lang } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const cat = new URLSearchParams(location.search).get('cat') || '';
  return (
    <ProductsDrawer
      open
      animate={false}
      cat={cat}
      onCat={(key) => navigate({ pathname: location.pathname, search: key === 'all' ? '' : `?cat=${encodeURIComponent(key)}` }, { replace: true })}
      onClose={() => navigate(`/${lang}`)}
    />
  );
}
