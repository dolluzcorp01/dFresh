// One main link (navLinks.js). The Products link opens the products drawer over the current page
// (spec A1); a modified click (new tab / window) still follows the real /:lang/products URL.
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { useOpenProducts } from '../products/useOpenProducts';
import { linkTarget } from './navLinks';

export default function NavLink({ link, onClick, children }) {
  const { lang } = useI18n();
  const openProducts = useOpenProducts();
  const click = (e) => {
    if (link.page === 'products' && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      openProducts({}, e.currentTarget);
    }
    if (onClick) onClick(e);
  };
  return <Link to={linkTarget(lang, link)} onClick={click}>{children}</Link>;
}
