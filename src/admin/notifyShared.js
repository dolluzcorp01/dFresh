// Shared bits of the three Communications pages (Notifications, Message templates, Outbox; phase 13, v23 section 15):
// who each event goes to, what it attaches, the message states and their pill, the on / off switch.
import { Pill } from './ui';

export const TO = { order: 'The order contact', invoice: 'Contacts with "gets invoices"', customer: "The customer's e-mail" };
export const STAFF_TO = { approval: 'Approvers who may decide it', stock_daily: 'Users with edit on Inventory', follow_ups: 'Each follow-up owner',
  delivery_failed: 'Users who plan trips', cash_difference: 'Users who plan trips', daily_summary: 'Admin users',
  admin_alert: 'Every Super admin and Admin (always sent)' };
export const ATTACH = { invoice: 'Invoice PDF', credit_note: 'Credit note PDF', statement: 'Statement PDF' };
export const STATUS = { queued: 'Queued', sent: 'Sent', failed: 'Failed', skipped: 'Not sent', prepared: 'Prepared', cancelled: 'Cancelled' };
export const STATUS_TONE = { queued: 'warn', sent: 'good', failed: 'bad', skipped: 'gray', cancelled: 'gray', prepared: 'info' };
export const CHANNEL = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' };

/** who an event goes to, in words */
export const goesTo = (ev) => (ev.audience === 'staff' ? STAFF_TO[ev.key] || 'Staff' : TO[ev.to] || 'The customer');

export function NoteStatus({ row }) {
  return (
    <Pill tone={STATUS_TONE[row.status] || 'gray'} title={row.status === 'skipped' || row.status === 'prepared' ? row.skip_reason : row.last_error || undefined}>
      {STATUS[row.status] || row.status}
    </Pill>
  );
}

export function Switch({ on, label, disabled, onChange }) {
  return (
    <span className="a-switch-row">
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="a-switch" disabled={disabled} onClick={() => onChange(!on)}>
        <span className="a-switch-knob" aria-hidden="true" />
      </button>
      <span>{on ? 'On' : 'Off'}</span>
    </span>
  );
}
