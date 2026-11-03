// Admin > Communications: Notifications / Message templates / Outbox (docs/COMMERCE-SPEC.md 5.5f; v23 section 15 pages;
// API /notifications, logic in src/backend_routes/notifications.js). One address with ?tab=events / templates / log, one
// menu entry each, each its own v23 page (no tabs between them):
// - events: NotifyEvents.js (channels, each event on / off by channel and who gets it, reminder numbers, daily mails)
// - templates: MessageTemplates.js (per event a column per language with "Check the wording"; the drawer edits and previews)
// - log: Outbox.js (status tabs with counts, filters, the message drawer, "Send again" for a failed e-mail)
// Every message is an e-mail through the mail outbox (CLAUDE.md rule 7); WhatsApp and SMS have no provider yet.
// View on Settings = everything read only; edit = switches, templates, test mail, retry, run now.
import { useLocation } from 'react-router-dom';
import { Loading, PageHead, useLoad } from './ui';
import NotifyEvents from './NotifyEvents';
import MessageTemplates from './MessageTemplates';
import Outbox from './Outbox';

export { NoteStatus } from './notifyShared';

const PAGES = {
  events: {
    sub: 'Who is told about what, and by which channel.',
    rules: ['Every message goes through the mail outbox', 'E-mail only: WhatsApp and SMS have no provider yet', 'An order waiting for approval sends nothing'],
  },
  templates: {
    sub: 'The wording of each message, in each language.',
    rules: ['Placeholders like {customer} are filled in when it is sent', 'A language left empty uses the default language', '"Check the wording": a default translation nobody has saved yet'],
  },
  log: {
    sub: 'Every message sent, and the failed ones',
    rules: ['Customers and staff, sent or not', 'A failed e-mail can be sent again', 'Test mails are hidden unless you ask'],
  },
};

export default function Notifications() {
  const data = useLoad('/notifications');
  const asked = new URLSearchParams(useLocation().search).get('tab');
  const tab = PAGES[asked] ? asked : 'events';
  const d = data.data;
  return (
    <section className="a-nt">
      <PageHead sub={PAGES[tab].sub} rules={PAGES[tab].rules} />
      <Loading state={data}>
        {d && tab === 'events' && <NotifyEvents d={d} reload={data.reload} />}
        {d && tab === 'templates' && <MessageTemplates d={d} reload={data.reload} />}
        {d && tab === 'log' && <Outbox d={d} />}
      </Loading>
    </section>
  );
}
