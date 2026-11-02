// The left menu (menu.js, generated from docs/STAGE2-MENU-GUIDE.txt) for one signed-in user: which entries they see,
// where each one goes, and which entry the current address belongs to (the highlighted item, the PageHead breadcrumb).
// - An entry with `to` (existing screens) is shown when the user may open one of its targets: the section's right
//   (src/shared/permissions.js), Commerce on for a commerce target, linked to a driver for a driver target. The first
//   such target is where it goes.
// - A placeholder entry (`phase`) needs the right of the section it will belong to, and is shown only while Commerce is
//   on: with Commerce off the menu is the live site's screens only.
// - A sub-group or group with nothing left in it is not shown.
import { useLocation } from 'react-router-dom';
import { MENU } from './menu';
import { useAdmin } from './ui/context';
import { can } from '../shared/permissions';

/** the line icon of each group (the guide's emoji = the v23 icon of that group) */
export const GROUP_ICON = { home: 'house', sales: 'trending-up', fulfilment: 'truck', purchase: 'shopping-cart', production: 'factory',
  inventory: 'package', money: 'wallet', gst: 'receipt', marketing: 'gift', reports: 'chart-pie', masters: 'book-open',
  website: 'globe', admin: 'settings', 'online-store': 'store' };

const okTarget = (me, t) => (!t.commerce || Boolean(me && me.commerce_enabled)) && (!t.driver || Boolean(me && me.is_driver))
  && (!t.section || can(me && me.perms, t.section, t.action || 'view'));

/** the target this user opens with the entry (null = they may not open it) */
export function targetFor(me, e) {
  if (e.to) return e.to.find((t) => okTarget(me, t)) || null;
  const placeholderOk = Boolean(me && me.commerce_enabled) && (!e.section || can(me && me.perms, e.section, 'view'));
  return placeholderOk ? { path: `p/${e.id}`, placeholder: true } : null;
}

/** /admin/... link of a target */
export const hrefOf = (t) => `/admin/${t.path}${t.search ? `?${t.search}` : ''}${t.hash ? `#${t.hash}` : ''}`;

/** The menu for this user: groups -> (sub-groups ->) entries, each entry with its `target`; empty parts dropped. */
export function menuFor(me) {
  const entry = (e) => { const target = targetFor(me, e); return target ? { ...e, target } : null; };
  return MENU.map((g) => {
    if (g.solo) { const e = entry(g); return e && { ...e, kids: undefined }; }
    const kids = g.kids.map((k) => {
      if (k.kids) { const sub = k.kids.map(entry).filter(Boolean); return sub.length ? { ...k, kids: sub } : null; }
      return entry(k);
    }).filter(Boolean);
    return kids.length ? { ...g, kids } : null;
  }).filter(Boolean);
}

/** every entry of a (filtered) menu with its group and sub-group, in menu order */
export function flatEntries(menu) {
  const out = [];
  for (const g of menu) {
    if (g.solo) { out.push({ group: g, sub: null, entry: g }); continue; }
    for (const k of g.kids) {
      if (k.kids) k.kids.forEach((e) => out.push({ group: g, sub: k, entry: e }));
      else out.push({ group: g, sub: null, entry: k });
    }
  }
  return out;
}

/**
 * The entry the address belongs to: same path, then the one whose ?tab= / ?status= and #part all match (the most
 * specific wins); a tab no entry names falls back to the first entry of that screen. null = no entry (e.g. a screen
 * reached from inside another page).
 */
export function activeEntry(menu, pathname, search, hash) {
  const path = pathname.replace(/^\/admin\/?/, '').replace(/\/$/, '');
  const params = new URLSearchParams(search);
  const h = (hash || '').replace(/^#/, '');
  let best = null;
  let bestScore = -1;
  for (const x of flatEntries(menu)) {
    const t = x.entry.target;
    if (t.path !== path) continue;
    const want = new URLSearchParams(t.search || '');
    let score = 0;
    let fits = true;
    want.forEach((v, k) => { if (params.get(k) === v) score += 2; else fits = false; });
    if (t.hash) { if (t.hash === h) score += 1; else fits = false; }
    if (!fits) score = -0.5; // same screen, another tab: only if nothing fits better
    if (score > bestScore) { best = x; bestScore = score; }
  }
  return best;
}

/** { group, sub, entry } of the current address for the signed-in user (null on screens no entry names) */
export function useMenuEntry() {
  const { me } = useAdmin();
  const { pathname, search, hash } = useLocation();
  return activeEntry(menuFor(me), pathname, search, hash);
}
