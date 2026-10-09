import { track } from './track';

// Spec A2: https://wa.me/<site_settings.whatsapp_number>?text=<message>
export function waHref(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function trackWhatsApp(item, location) {
  track('whatsapp_click', { item, location });
}
