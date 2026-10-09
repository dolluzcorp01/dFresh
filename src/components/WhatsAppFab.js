// Floating WhatsApp button on every screen (spec A2), general message in the current language.
import { useI18n } from '../i18n/useT';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import { WhatsAppIcon } from './Icons';
import './WhatsAppFab.css';

export default function WhatsAppFab() {
  const { t, settings } = useI18n();
  return (
    <a
      className="fab"
      href={waHref(settings.whatsapp_number, t('wa_general'))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('wa_float')}
      onClick={() => trackWhatsApp('general', 'fab')}
    >
      <WhatsAppIcon />
    </a>
  );
}
