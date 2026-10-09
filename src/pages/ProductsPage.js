// /:lang/products. Phase 2 placeholder; the products drawer (search, filters, flip cards) is Phase 4.
import { useI18n } from '../i18n/useT';

export default function ProductsPage() {
  const { t, data } = useI18n();
  return (
    <section className="sec">
      <div className="wrap sh">
        <h2>{t('all_h')}</h2>
        <p>{t('n_products', { n: data.stats.products })}</p>
      </div>
    </section>
  );
}
