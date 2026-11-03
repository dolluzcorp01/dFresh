// The one page every menu entry with no screen yet opens (/admin/p/<entry id>): its title and breadcrumb, a
// "Not built yet - phase NN" pill (or "Later"), and the guide's "What you see" / "Use it to" texts
// (docs/STAGE2-MENU-GUIDE.txt via menu.js). An entry this user may not open says so, as any other page.
import { useLocation } from 'react-router-dom';
import { MENU } from './menu';
import { GROUP_ICON, flatEntries, targetFor } from './menuAccess';
import { Empty, NoAccess, PageHead, Pill, useAdmin } from './ui';

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

export default function Placeholder() {
  const { me } = useAdmin();
  const { pathname } = useLocation();
  const id = decodeURIComponent(pathname.replace(/^\/admin\/p\//, '').replace(/\/$/, ''));
  const x = flatEntries(MENU).find((f) => f.entry.id === id);
  if (!x || x.entry.to) return <section><PageHead title="Page not found" crumb={['Back Office']} /><Empty title="No such page">Pick a page in the menu.</Empty></section>;
  const e = x.entry;
  if (!targetFor(me, e)) return <NoAccess section={e.section} />;
  const pill = e.phase === 'later' ? 'Later' : e.phase === 'fv7' ? 'Later (Foundation v7)' : `Not built yet - phase ${e.phase}`;
  return (
    <section className="a-placeholder">
      <PageHead title={e.label} crumb={[x.group.label, x.sub && x.sub.label, x.entry !== x.group && e.label].filter(Boolean)}
        sub={x.group.desc ? `${x.group.label}: ${x.group.desc}` : undefined} />
      <div className="a-card">
        <Empty icon={GROUP_ICON[x.group.key] || 'list-todo'} title={e.label}>
          <Pill tone={['later', 'fv7'].includes(e.phase) ? 'gray' : 'warn'}>{pill}</Pill>
        </Empty>
        <dl className="a-kv a-ph-kv">
          <dt>What you see</dt><dd>{cap(e.see)}</dd>
          <dt>Use it to</dt><dd>{cap(e.use)}</dd>
        </dl>
      </div>
    </section>
  );
}
