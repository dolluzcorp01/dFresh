# Builds src/admin/menu.js and docs/STAGE2-MENU-MAP.md from docs/STAGE2-MENU-GUIDE.txt (the 148-line menu tree) and
# the map below (which existing screen each entry opens). Run after changing either:  python scripts/admin-check/menu-build.py
# Names, order and the "What you see" / "Use it to" texts come from the guide only; a "(not built yet)" or "(later)"
# after a name becomes the entry's tag. An entry not in MAP opens the shared placeholder with the phase of its
# section (gap map build order). Plain hyphens only.
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GUIDE = os.path.join(ROOT, 'docs', 'STAGE2-MENU-GUIDE.txt')


def parse():
    out, cur = [], None
    for i, l in enumerate(open(GUIDE, encoding='utf8').read().split('\n')):
        m = re.match(r'^([│ ]*)(├──|└──) (.*)$', l)
        if m:
            cur = {'depth': len(m.group(1)) // 4, 'text': m.group(3).strip(), 'line': i + 1}
            out.append(cur)
            continue
        m2 = re.match(r'^[│ ]*(What you see|Use it to)\s*:\s*(.*)$', l)
        if m2 and cur:
            cur.setdefault(m2.group(1), []).append(m2.group(2).strip())
            cur['_last'] = m2.group(1)
            continue
        m3 = re.match(r'^[│ ]{8,}(\S.*)$', l)
        if m3 and cur and cur.get('_last'):
            cur[cur['_last']].append(m3.group(1).strip())
    return out


def slug(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def split_tag(text):
    m = re.match(r'^(.*?)\s*\((not built yet|later)\)$', text)
    return (m.group(1), m.group(2)) if m else (text, None)


# target: path under /admin, the permission it needs (section, action), commerce = only while Commerce is on,
# search / hash = the tab or part of the screen. Several targets = the first one this user may open.
def T(path, section, action='view', commerce=True, search='', hash='', driver=False):
    return {k: v for k, v in dict(path=path, section=section, action=action, commerce=commerce, search=search, hash=hash, driver=driver).items() if v not in ('', False) or k in ('path', 'commerce')}


LIVE = dict(commerce=False)
MAP = {
    'home/dashboard': [T('commerce/ops', None), T('', None, **LIVE)],
    'home/approvals': [T('approvals', None)],
    'sales/leads/enquiries': [T('leads', 'leads', **LIVE)],
    'sales/leads/follow-ups': [T('commerce/follow-ups', 'customers')],
    'sales/customers/customer-list': [T('commerce/customers', 'customers')],
    'sales/customers/customer-types': [T('commerce-settings', 'settings', hash='cs-l-customer_types')],
    'sales/orders/orders': [T('commerce/orders', 'orders')],
    'sales/returns/return-requests': [T('commerce/returns', 'returns')],
    'sales/returns/inspection': [T('commerce/returns', 'returns', search='status=received')],
    'fulfilment/packing/to-pick': [T('commerce/packing', 'packing', search='tab=pick')],
    'fulfilment/packing/packing': [T('commerce/packing', 'packing', search='tab=packing')],
    'fulfilment/packing/packed-waiting': [T('commerce/packing', 'packing', search='tab=packed')],
    'fulfilment/delivery/trips': [T('commerce/delivery', 'delivery', 'create', search='tab=trips'), T('commerce/my-trips', 'delivery', driver=True)],
    'fulfilment/delivery/courier-and-pickup': [T('commerce/delivery', 'delivery', 'create', search='tab=other')],
    'fulfilment/delivery/failed-short-refused': [T('commerce/delivery', 'delivery', 'create', search='tab=failed')],
    'purchase/goods-in': [T('commerce/stock', 'inventory', search='tab=in')],
    'inventory/stock-status': [T('commerce/stock', 'inventory')],
    'inventory/batches-and-expiry': [T('commerce/stock', 'inventory', search='tab=batches')],
    'inventory/stock-take': [T('commerce/stock', 'inventory', search='tab=counts')],
    'inventory/write-offs': [T('commerce/stock', 'inventory', search='tab=writeoffs')],
    'inventory/reorder': [T('commerce/stock', 'inventory', search='tab=reorder')],
    'inventory/stock-ledger': [T('commerce/stock', 'inventory', search='tab=moves')],
    'money/accounting-export/export-to-accountant': [T('commerce/reports', 'reports', search='tab=accounting')],
    'gst/gstr-1-gstr-3b-data': [T('commerce/reports', 'reports', search='tab=gst')],
    'marketing/offers': [T('commerce/promotions', 'promotions', search='tab=offers')],
    'marketing/coupons': [T('commerce/promotions', 'promotions', search='tab=coupons')],
    'marketing/cashback-rules': [T('commerce/promotions', 'promotions', search='tab=cashback')],
    'marketing/customer-wallets': [T('commerce/promotions', 'promotions', search='tab=wallets')],
    'reports/sales-and-purchases': [T('commerce/reports', 'orders', search='tab=sales')],
    'reports/stock': [T('commerce/reports', 'inventory', search='tab=stock')],
    'reports/money-owed': [T('commerce/reports', 'customers', search='tab=receivables')],
    'reports/gst-and-delivery': [T('commerce/reports', 'delivery', search='tab=delivery')],
    'masters/catalogue/products-and-skus': [T('products', 'products', **LIVE)],
    'masters/catalogue/categories': [T('categories', 'products', **LIVE)],
    'masters/catalogue/kits': [T('kits', 'products', **LIVE)],
    'masters/catalogue/barcodes-and-labels': [T('commerce/skus', 'inventory')],
    'masters/prices/price-lists': [T('commerce/prices', 'products')],
    'masters/partners/suppliers': [T('commerce/stock', 'inventory', search='tab=suppliers')],
    'masters/partners/vehicles-and-drivers': [T('commerce-settings', 'settings', hash='cs-l-vehicles')],
    'masters/partners/couriers': [T('commerce-settings', 'settings', hash='cs-l-couriers')],
    'masters/tax-and-units/delivery-areas': [T('commerce-settings', 'settings', hash='cs-l-delivery_areas')],
    'website/home-page/banners': [T('banners', 'content', **LIVE)],
    'website/home-page/home-doors': [T('settings', 'settings', hash='cs-s-home-page', **LIVE)],
    'website/home-page/most-loved': [T('products', 'products', hash='most-loved', **LIVE)],
    'website/home-page/size-picker': [T('size-picker', 'products', **LIVE)],
    'website/home-page/kits-on-the-site': [T('kits', 'products', hash='on-site', **LIVE)],
    'website/words-and-languages/translations': [T('translations', 'content', **LIVE)],
    'website/words-and-languages/languages': [T('languages', 'content', **LIVE)],
    'website/brochures': [T('brochures', 'content', **LIVE)],
    'website/forms/form-options': [T('form-options', 'content', **LIVE)],
    'website/where-we-deliver-map': [T('towns', 'content', **LIVE)],
    'website/google-and-sharing': [T('settings', 'settings', hash='cs-s-sharing-and-seo', **LIVE)],
    'website/site-settings': [T('settings', 'settings', **LIVE)],
    'admin/organisation/company': [T('settings', 'settings', hash='cs-s-company', **LIVE)],
    'admin/organisation/godowns': [T('godowns', 'settings')],
    'admin/organisation/numbering': [T('commerce-settings', 'settings', hash='cs-g-numbering')],
    'admin/users-and-security/staff': [T('users', 'users', **LIVE)],
    'admin/users-and-security/roles': [T('roles', 'users', **LIVE)],
    'admin/users-and-security/approval-rules': [T('approval-rules', 'settings'), T('approval-rules', 'users')],
    'admin/users-and-security/stand-ins': [T('stand-ins', 'users')],
    'admin/users-and-security/audit-log': [T('audit', 'audit', **LIVE)],
    'admin/communications/notifications': [T('notifications', 'settings', search='tab=events')],
    'admin/communications/message-templates': [T('notifications', 'settings', search='tab=templates')],
    'admin/communications/outbox': [T('notifications', 'settings', search='tab=log')],
    'admin/settings/switches': [T('commerce-settings', 'settings', **LIVE)],
}

# placeholder: the permission section of an entry with no screen yet (what it will belong to), by entry id prefix
PLACE_SECTION = [
    ('home/', None), ('sales/leads/', 'leads'), ('sales/customers/', 'customers'), ('sales/orders/', 'orders'), ('sales/returns/', 'returns'),
    ('fulfilment/', 'delivery'), ('purchase/', 'inventory'), ('production/', 'inventory'), ('inventory/', 'inventory'),
    ('money/payments/refunds', 'returns'), ('money/payments/supplier-payments', 'inventory'), ('money/billing/', 'orders'), ('money/payments/', 'orders'),
    ('money/', 'reports'), ('gst/', 'reports'), ('marketing/', 'promotions'), ('reports/', 'reports'),
    ('masters/catalogue/raw-materials', 'inventory'), ('masters/', 'products'), ('website/', 'content'),
    ('admin/users-and-security/', 'users'), ('admin/', 'settings'), ('online-store', 'settings'),
]
# the phase that builds an entry (gap map "Proposed build order"); website entries with no screen: phase 24
PHASE = [
    ('home/my-tasks', 13), ('home/alerts', 23), ('sales/leads/', 19), ('sales/customers/customer-ledger', 21), ('sales/customers/', 19),
    ('sales/orders/', 19), ('sales/returns/', 22), ('fulfilment/', 20), ('purchase/', 16), ('production/', 17), ('inventory/', 18),
    ('money/payments/supplier-payments', 16), ('money/expenses/', 23), ('money/accounting-export/', 23), ('money/', 21), ('gst/', 21),
    ('marketing/', 22), ('reports/', 23), ('masters/catalogue/', 14), ('masters/prices/', 15), ('masters/partners/suppliers', 16),
    ('masters/partners/', 20), ('masters/tax-and-units/hsn-and-gst-rates', 15), ('masters/tax-and-units/', 14), ('website/', 24),
    ('admin/communications/', 23), ('admin/', 13),
]


def first(rules, eid):
    for prefix, v in rules:
        if eid.startswith(prefix):
            return v
    sys.exit(f'no rule for {eid}')


def build():
    nodes = parse()
    menu, entries = [], []
    gi = si = None
    for n in nodes:
        name, tag = split_tag(n['text'])
        if n['depth'] == 0:
            m = re.match(r'^(\S+)\s+(.+?)(?:\s+-\s+(.*))?$', name)
            icon, gname, desc = m.group(1), m.group(2), m.group(3) or ''
            gname, gtag = split_tag(gname)
            gkey = slug(gname)
            gi = {'key': gkey, 'icon': icon, 'label': gname if len(gname) <= 3 else gname.capitalize(), 'desc': desc, 'kids': []}
            if gtag:
                gi['tag'] = gtag
            menu.append(gi)
            si = None
            if 'What you see' in n:  # a top line with no pages under it (Online store): itself the entry
                gi.update(solo=True, id=gkey, see=' '.join(n['What you see']), use=' '.join(n.get('Use it to', [])))
                del gi['kids']
                entries.append((gi, None, gi))
            continue
        if 'What you see' not in n:  # a sub-group
            si = {'key': f"{gi['key']}/{slug(name)}", 'label': name, 'kids': []}
            if tag:
                si['tag'] = tag
            gi['kids'].append(si)
            continue
        if n['depth'] == 1:
            si = None
        e = {'id': f"{gi['key']}/{(slug(si['label']) + '/') if si else ''}{slug(name)}", 'label': name,
             'see': ' '.join(n['What you see']), 'use': ' '.join(n.get('Use it to', []))}
        if tag:  # the page's own "(not built yet)" / "(later)" only; a sub-group's tag stays on the sub-group
            e['tag'] = tag
        (si or gi)['kids'].append(e)
        entries.append((gi, si, e))
    # targets, placeholder phase and section
    used = set()
    for g, s, e in entries:
        eid = e['id']
        if eid in MAP:
            e['to'] = MAP[eid]
            used.add(eid)
        else:
            e['section'] = first(PLACE_SECTION, eid)
            if e.get('tag') == 'later' or g.get('solo'):
                e['phase'] = 'later'
            else:
                e['phase'] = first(PHASE, eid)
    missing = set(MAP) - used
    if missing:
        sys.exit(f'MAP ids not in the guide: {sorted(missing)}')
    return nodes, menu, entries


def js(menu, count):
    body = json.dumps(menu, ensure_ascii=False, indent=1)
    body = re.sub(r'"([a-zA-Z_]+)":', r'\1:', body)  # JS object keys
    return (
        "// GENERATED by scripts/admin-check/menu-build.py from docs/STAGE2-MENU-GUIDE.txt - do not edit by hand.\n"
        "// The admin left menu (Stage 2): 13 groups and Online store, their sub-groups and pages, in the guide's order\n"
        f"// ({count} entries). An entry with `to` opens an existing screen (the first target this user may open); one with\n"
        "// `phase` opens the shared placeholder page (Not built yet - phase NN, or Later) with the guide's texts.\n"
        f"export const MENU_COUNT = {count};\n"
        f"export const MENU = {body};\n"
    )


def doc(entries):
    rows = []
    for g, s, e in entries:
        where = ' / '.join(x for x in [g['label'], s['label'] if s else '', e['label'] if e is not g else ''] if x)
        if 'to' in e:
            t = '; '.join(f"/admin/{x['path']}{('?' + x['search']) if x.get('search') else ''}{('#' + x['hash']) if x.get('hash') else ''}"
                          + (' (drivers)' if x.get('driver') else '') + ('' if x['commerce'] else ' (live)') for x in e['to'])
            rows.append(f"| {where} | {t} |")
        else:
            rows.append(f"| {where} | placeholder: {'Later' if e['phase'] == 'later' else 'Not built yet - phase ' + str(e['phase'])} |")
    return rows


if __name__ == '__main__':
    nodes, menu, entries = build()
    count = len(nodes)
    assert count == 148, count
    open(os.path.join(ROOT, 'src', 'admin', 'menu.js'), 'w', encoding='utf8', newline='\n').write(js(menu, count))
    rows = doc(entries)
    built = sum(1 for _, _, e in entries if 'to' in e)
    subs = sum(1 for n in nodes if n['depth'] > 0 and 'What you see' not in n)
    groups = sum(1 for g in menu if not g.get('solo'))
    head = ('# Stage 2 menu map: every page of the left menu and the screen it opens\n\n'
            'GENERATED by `scripts/admin-check/menu-build.py` from docs/STAGE2-MENU-GUIDE.txt and the MAP in that script;\n'
            'do not edit by hand. A path opens an existing screen (`?tab=` / `#part` = the tab or part of it); several\n'
            'paths = the first one the user may open. "(live)" = also shown while Commerce is switched off (the live\n'
            "site's screens); every other entry shows only while Commerce is on. A placeholder shows the guide's texts and\n"
            'the phase that builds it (gap map build order; Website entries with no screen: phase 24, agreed 2 Nov 2026).\n\n'
            f'{count} menu lines = {groups} groups + Online store + {subs} sub-groups + {len(entries) - 1} pages. Of the '
            f'{len(entries)} entries that open something (pages and Online store), {built} open a screen and '
            f'{len(entries) - built} the placeholder.\n\n'
            '| Menu page | Opens |\n|---|---|\n')
    open(os.path.join(ROOT, 'docs', 'STAGE2-MENU-MAP.md'), 'w', encoding='utf8', newline='\n').write(head + '\n'.join(rows) + '\n')
    print(f'{count} menu lines: {groups} groups, Online store, {subs} sub-groups, {len(entries) - 1} pages; '
          f'{built} entries open a screen, {len(entries) - built} the placeholder')
