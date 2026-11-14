// Section 18 - Website pages (phase 24, the owner's field map docs/claude-tasks/done/phase-24-field-map.md). The
// acceptance flow by script: a dated banner appears and goes on its dates; a door re-pointed to a category; the quote
// form with Town optional accepts a lead without a town and Phone cannot be made optional; the spam limit set to 2
// refuses the third enquiry; a town ticked "Show on map" appears on the map; a menu link hidden and reordered in all
// three menus; a third visit card filled from a godown; the leads e-mail change and two-step sign-in off wait for a
// second Admin; a fourth language row shows its texts with no code change. The site side is read from the public API
// (bootstrap, POST /leads) mounted here next to the admin API, in the same process (one content cache).
// Run with MAIL_ENABLED=false: npm run scenarios -- 18
const path = require('path');
const { ROOT } = require('./lib');
const { istToday, addDays } = require(path.join(ROOT, 'src', 'shared', 'istDate'));

async function startSite() {
  const express = require('express');
  const app = express();
  app.set('trust proxy', 'loopback'); // as server.js: X-Forwarded-For from this process = the visitor's address
  app.use(express.json());
  app.use('/api/dfresh', require(path.join(ROOT, 'src', 'backend_routes', 'Public_server')));
  app.use('/api/dfresh', require(path.join(ROOT, 'src', 'backend_routes', 'Leads_server')));
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/dfresh`;
  const get = async (p) => { const r = await fetch(`${base}${p}`); const j = await r.json().catch(() => null); return { status: r.status, data: j && j.data }; };
  const lead = async (body, ip) => {
    const r = await fetch(`${base}/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    return { status: r.status, data: j && j.data, fields: j && j.fields, msg: j && j.message, key: j && j.errorKey };
  };
  return { get, lead, close: () => new Promise((res) => server.close(res)) };
}

module.exports = {
  title: 'Website pages',
  async run(ctx) {
    const { api, ok, say, q1, decideAny, T, fresh, run } = ctx;
    if (process.env.MAIL_ENABLED !== 'false') throw new Error('run with MAIL_ENABLED=false (no mail from test runs, CLAUDE.md rule 7)');
    const site = await startSite();
    const boot = async (lang = 'en') => (await site.get(`/bootstrap?lang=${lang}`)).data;
    const today = istToday();
    let ipN = 0;
    const ip = () => `10.18.0.${(ipN += 1)}`; // a new visitor address per flow (the spam limit counts per address)
    try {
      if (run('18.1')) { await fresh(); T('18.1', 'A dated banner appears and goes on its dates (rows 10, 11)');
        const b = (await api('SH', 'GET', '/banners')).data.find((x) => x.is_active);
        const put = (v) => api('SH', 'PUT', `/banners/${b.banner_key}`, { ...v });
        const on = async () => (await boot()).banners.some((x) => x.key === b.banner_key);
        const s0 = await on();
        const r1 = await put({ show_from: addDays(today, 1), show_until: null });
        const s1 = await on();
        const r2 = await put({ show_from: today, show_until: today, tr: { ...b.tr, en: { ...b.tr.en, alt_text: 'Napkins on a festive table' } } });
        const bo2 = await boot();
        const s2 = bo2.banners.find((x) => x.key === b.banner_key);
        const r3 = await put({ show_from: addDays(today, -5), show_until: addDays(today, -1) });
        const s3 = await on();
        const bad = await put({ show_from: today, show_until: addDays(today, -1) });
        const ta = (await boot('ta')).banners.length;
        ok(s0 && r1.status === 200 && !s1 && r2.status === 200 && s2 && s2.alt === 'Napkins on a festive table' && r3.status === 200 && !s3 && bad.status === 400,
          `${b.banner_key}: shown at first ${s0}; from tomorrow (${addDays(today, 1)}): shown ${s1}; today only: shown ${Boolean(s2)}, alt "${s2 && s2.alt}"; ended yesterday: shown ${s3}; until before from: ${bad.status} "${bad.msg}"; TA banners now ${ta}`); }

      if (run('18.2')) { await fresh(); T('18.2', 'A home door re-pointed to a category (row 15)');
        const d = (await api('SH', 'GET', '/website/doors')).data;
        const cat = d.categories.find((c) => c.is_active).category_key;
        const r = await api('SH', 'PUT', '/website/doors/home', { action: 'products_category', target: cat });
        const s = (await boot()).settings;
        const bad = await api('SH', 'PUT', '/website/doors/biz', { action: 'section', target: 'nowhere' });
        const s2 = (await boot()).settings;
        ok(r.status === 200 && s.door_home_action === 'products_category' && s.door_home_target === cat && bad.status === 400 && s2.door_biz_target === 'business',
          `For Home was ${d.doors[0].action}${d.doors[0].target ? `:${d.doors[0].target}` : ''}, now ${s.door_home_action}:${s.door_home_target}; a section not on the list: ${bad.status} "${JSON.stringify(bad.fields)}", For Business still ${s2.door_biz_action}:${s2.door_biz_target}`); }

      if (run('18.3')) { await fresh(); T('18.3', 'Quote form: Town optional, Phone locked (rows 39 to 69)');
        const before = (await boot()).formRules.forms.quote.find((f) => f.name === 'town');
        const r = await api('SH', 'PUT', '/website/form-rules/field', { form_type: 'quote', field_name: 'town', required: false });
        const after = (await boot()).formRules.forms.quote.find((f) => f.name === 'town');
        const ph = await api('SH', 'PUT', '/website/form-rules/field', { form_type: 'quote', field_name: 'phone', required: false });
        const phNow = await q1("SELECT is_required FROM form_fields WHERE form_type = 'quote' AND field_name = 'phone'");
        const prod = await q1('SELECT p.product_id FROM products p JOIN categories c ON c.category_key = p.category_key AND c.is_active = 1 WHERE p.is_active = 1 ORDER BY p.product_id LIMIT 1');
        const bt = await q1("SELECT option_value FROM form_options WHERE list_key = 'business_type' AND is_active = 1 ORDER BY sort_order LIMIT 1");
        const body = { form_type: 'quote', lang: 'en', consent: true, full_name: 'Scenario Eighteen', business_name: 'Hotel Kanchi', business_type: bt.option_value,
          phone: '98765 43210', email: 'scenario18@example.com', products: [prod.product_id] };
        const l = await site.lead(body, ip());
        const row = l.data && l.data.lead_ref ? await q1('SELECT lead_ref, town, phone FROM leads WHERE lead_ref = ?', [l.data.lead_ref]) : null;
        const noPhone = await site.lead({ ...body, phone: '' }, ip());
        ok(before.required && r.status === 200 && after.required === false && ph.status === 409 && Number(phNow.is_required) === 1 && l.status === 201 && row && !row.town && noPhone.status === 400 && noPhone.fields && noPhone.fields.phone,
          `town required ${before.required} -> ${after.required}; Phone optional: ${ph.status} "${ph.msg}" (still required ${phNow.is_required}); quote without a town: ${l.status} ${row && `${row.lead_ref} town "${row.town || ''}" phone ${row.phone}`}; without a phone: ${noPhone.status} ${JSON.stringify(noPhone.fields)}`); }

      if (run('18.4')) { await fresh(); T('18.4', 'Spam limit 2 refuses the third enquiry (row 67)');
        const bad = await api('SH', 'PUT', '/website/form-rules/limits', { rate_max: 21 });
        const r = await api('SH', 'PUT', '/website/form-rules/limits', { rate_max: 2 });
        const who = ip();
        const one = (n) => site.lead({ form_type: 'contact', lang: 'en', consent: true, full_name: `Rate ${n}`, phone: '98765 43210', email: `rate${n}@example.com`, message: 'Please call back.' }, who);
        const a = await one(1); const b = await one(2); const c = await one(3);
        const d = await site.lead({ form_type: 'contact', lang: 'en', consent: true, full_name: 'Another visitor', phone: '98765 43210', email: 'other@example.com', message: 'Hello.' }, ip());
        ok(bad.status === 400 && r.status === 200 && a.status === 201 && b.status === 201 && c.status === 429 && d.status === 201,
          `21: ${bad.status} ${JSON.stringify(bad.fields)}; limit 2 saved; one visitor: ${a.status}, ${b.status}, third ${c.status} (${c.key || c.msg}); another visitor: ${d.status}`); }

      if (run('18.5')) { await fresh(); T('18.5', 'A town ticked "Show on map" in Delivery areas appears on the map (row 75)');
        const n = await api('SH', 'POST', '/fulfil/areas', { label: 'Uthiramerur', towns: '603406', charge: '100', days: ['Tue'], godown_id: 1, show_on_map: false, is_active: true });
        const id = (await q1("SELECT area_id FROM delivery_areas WHERE label = 'Uthiramerur'")).area_id;
        const t0 = (await boot()).towns.map((t) => t.name);
        const r = await api('SH', 'PUT', `/website/map/${id}`, { show_on_map: true, names: { en: 'Uthiramerur', ta: 'உத்திரமேரூர்' }, map_x: 230, map_y: 270 });
        const t1 = (await boot()).towns; const t1ta = (await boot('ta')).towns;
        const town = t1.find((t) => t.name === 'Uthiramerur');
        const mapPage = (await api('SH', 'GET', '/website/map')).data.areas.filter((a) => a.show_on_map).map((a) => a.label);
        ok(n.status < 300 && !t0.includes('Uthiramerur') && r.status === 200 && town && town.mapX === 230 && t1ta.some((t) => t.name === 'உத்திரமேரூர்') && mapPage.includes('Uthiramerur'),
          `new delivery area ${id} (not on the map): towns ${t0.join(', ')}; ticked: ${t1.map((t) => t.name).join(', ')} (pin ${town && `${town.mapX},${town.mapY}`}); TA name ${t1ta[t1ta.length - 1].name}`); }

      if (run('18.6')) { await fresh(); T('18.6', 'A menu link hidden and reordered in all three menus (rows 76 to 80)');
        const L = (await api('SH', 'GET', '/website/menu-links')).data.links;
        const menus = (b) => Object.fromEntries(['header', 'phone', 'footer'].map((m) => [m, b.menuLinks.filter((x) => x[m]).map((x) => x.key)]));
        const m0 = menus(await boot());
        const h = await api('SH', 'PUT', '/website/menu-links/about', { is_active: 0 });
        const keys = L.map((l) => l.link_key);
        const order = ['where', ...keys.filter((k) => k !== 'where')];
        const o = await api('SH', 'PUT', '/website/menu-links-order', { keys: order });
        const m1 = menus(await boot());
        const ext = await api('SH', 'POST', '/website/menu-links', { names: { en: 'Amazon' }, target_kind: 'url', target: 'https://amazon.in' });
        ok(h.status === 200 && o.status === 200 && ['header', 'phone', 'footer'].every((m) => m1[m][0] === 'where' && !m1[m].includes('about')) && m0.header.includes('about') && ext.status === 400,
          `before: header ${m0.header.join(',')} | phone ${m0.phone.join(',')} | footer ${m0.footer.join(',')}; after hiding about and moving where first: header ${m1.header.join(',')} | phone ${m1.phone.join(',')} | footer ${m1.footer.join(',')}; a link to another website: ${ext.status}`); }

      if (run('18.7')) { await fresh(); T('18.7', 'A third visit card filled from a godown (rows 82 to 88)');
        const v = (await api('SH', 'GET', '/website/visit-cards')).data;
        const g = v.godowns[v.godowns.length - 1];
        const r = await api('SH', 'POST', '/website/visit-cards', { names: { en: g.name }, addresses: { en: g.address }, hours: { en: g.hours || '' }, phone: g.phone, godown_id: g.godown_id, map_query: g.address });
        const cards = (await boot()).visitCards; const ta = (await boot('ta')).visitCards;
        const c3 = cards[2];
        ok(v.cards.length === 2 && r.status === 200 && cards.length === 3 && c3.name === g.name && c3.address === g.address && c3.query === g.address && ta.length === 3 && ta[2].name === g.name,
          `cards before ${v.cards.length}; filled from ${g.name} (${g.code}): "${c3 && c3.address}", phone ${c3 && c3.phone}, hours ${c3 && c3.hours}; site now ${cards.map((c) => c.name).join(' | ')}; TA third card falls back to "${ta[2] && ta[2].name}"`); }

      if (run('18.8')) { await fresh(); T('18.8', 'The leads e-mail change waits for a second Admin (row 97)');
        const was = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'lead_email'")).v;
        const r = await api('SH', 'PUT', '/settings/lead_email', { value: 'leads-test@dolluzcorp.com' });
        const mid = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'lead_email'")).v;
        const row = (await api('SH', 'GET', '/settings')).data.find((s) => s.setting_key === 'lead_email');
        const self = await api('SH', 'POST', `/approvals/${r.data && r.data.approval_id}/decide`, { decision: 'approved', note: 'self' });
        const d = await decideAny(r.data.approval_id);
        const end = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'lead_email'")).v;
        ok(r.status === 200 && r.data.waiting && mid === was && row.waiting && row.waiting.value === 'leads-test@dolluzcorp.com' && self.status !== 200 && d && d.status === 200 && end === 'leads-test@dolluzcorp.com',
          `asked: "${r.data && r.data.message}"; meanwhile ${mid}; the page shows waiting ${JSON.stringify(row.waiting)}; the asker signs: ${self.status}; another Admin signs: ${end}`); }

      if (run('18.9')) { await fresh(); T('18.9', 'Two-step sign-in off waits for a second Admin (row 101)');
        await ctx.pool.query("UPDATE site_settings SET setting_value = 'on' WHERE setting_key = 'two_step_login'"); // the test starts with it on
        const r = await api('SH', 'POST', '/settings/two-step-login/off');
        const mid = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'two_step_login'")).v;
        const typed = await api('SH', 'PUT', '/settings/two_step_login', { value: 'off' });
        const mid2 = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'two_step_login'")).v;
        const d = await decideAny(r.data.approval_id);
        const end = (await q1("SELECT setting_value v FROM site_settings WHERE setting_key = 'two_step_login'")).v;
        ok(r.status === 200 && r.data.waiting && mid === 'on' && mid2 === 'on' && d && d.status === 200 && end === 'off',
          `asked: "${r.data && r.data.message}"; meanwhile ${mid}; typed PUT: ${typed.status} ${typed.data && typed.data.waiting ? '(waits too)' : typed.msg || ''} -> still ${mid2}; after a second Admin: ${end}`); }

      if (run('18.10')) { await fresh(); T('18.10', 'A fourth language row: its texts show on the new pages with no code change (rules 1, 2)');
        await ctx.pool.query("INSERT INTO languages (lang_code, name_en, native_name, switch_label, html_lang, dir, font_family, is_default, is_active, sort_order) VALUES ('te', 'Telugu', 'తెలుగు', 'తెలుగు', 'te-IN', 'ltr', 'Noto Sans Telugu', 0, 1, 4)");
        const words = { nav_where: 'మేము ఎక్కడ డెలివరీ చేస్తాము', c_office: 'పడూర్ కార్యాలయం', e_fill: 'దయచేసి దీన్ని పూరించండి', wa_general: 'హలో dFresh' };
        const puts = [];
        for (const [k, w] of Object.entries(words)) puts.push((await api('SH', 'PUT', `/ui-text/${k}/te`, { value: w })).status); // the Translations rows (also editable on the Website pages)
        const t = await boot('te');
        const link = t.menuLinks.find((l) => l.key === 'where');
        const card = t.visitCards[0];
        const pages = await Promise.all(['/website/menu-links', '/website/visit-cards', '/website/map'].map((p) => api('SH', 'GET', p)));
        const fr = (await api('SH', 'GET', '/website/form-rules')).data.texts.find((x) => x.text_key === 'e_fill');
        ok(puts.every((s) => s === 200) && t.lang === 'te' && t.ui[link.textKey] === words.nav_where && card.name === words.c_office && t.ui.e_fill === words.e_fill && t.ui.wa_general === words.wa_general
          && pages.every((p) => p.data.languages.includes('te')) && fr.values.te === words.e_fill,
          `te bootstrap: menu "${t.ui[link.textKey]}", first card "${card.name}" (address falls back: "${card.address}"), error "${t.ui.e_fill}", WhatsApp "${t.ui.wa_general}"; admin pages list languages ${pages[0].data.languages.join(',')}`); }
      if (run('18.11')) { await fresh(); T('18.11', 'A town only on the old map stays map only: on the map, not for orders, charges or trips until an Admin turns it on (row 75)');
        const { deliveryCharge } = require(path.join(ROOT, 'src', 'backend_routes', 'commerce'));
        const row = await q1("SELECT area_id, label, towns, charge, days, is_active, show_on_map, map_key FROM delivery_areas WHERE map_key = 'wallajabad'");
        const onMap = (await boot()).towns.some((t) => t.key === 'wallajabad');
        const ship = { town: 'Wallajabad', pincode: '631605' };
        const c0 = await deliveryCharge(ctx.pool, ship, 1000);
        const c0id = await deliveryCharge(ctx.pool, ship, 1000, row.area_id); // even when the area is named
        const cust = await q1("SELECT customer_id FROM customers WHERE status = 'active' ORDER BY customer_id LIMIT 1");
        const addr = { kind: 'shipping', name: 'Wallajabad shop', address: '1 Main Road', town: 'Wallajabad', state_code: '33', pincode: '631605', delivery_area_id: row.area_id };
        const a0 = await api('SH', 'POST', `/commerce/customers/${cust.customer_id}/addresses`, addr);
        const t0 = await api('SH', 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: ['DFO-NONE'], area_id: row.area_id });
        const areas = (await api('SH', 'GET', '/fulfil/areas')).data.rows.find((x) => x.area_id === row.area_id);
        // an Admin turns it on in Masters > Delivery areas (PIN code, days and charge set)
        const on = await api('SH', 'PUT', `/fulfil/areas/${row.area_id}`, { label: 'Wallajabad', towns: 'Wallajabad, 631605', charge: '80', days: ['Wed'], godown_id: 1, show_on_map: true, is_active: true });
        const c1 = await deliveryCharge(ctx.pool, ship, 1000);
        const a1 = await api('SH', 'POST', `/commerce/customers/${cust.customer_id}/addresses`, addr);
        const after = await q1('SELECT is_active, show_on_map, charge, towns FROM delivery_areas WHERE area_id = ?', [row.area_id]);
        ok(row && Number(row.is_active) === 0 && Number(row.show_on_map) === 1 && onMap && !c0.area && !c0id.area && c0.charge === 0 && a0.status === 400 && /not an active delivery area/.test(JSON.stringify(a0.fields))
          && t0.status === 400 && /not an active delivery area/.test(t0.msg) && areas && !areas.is_active && on.status < 300 && c1.area && c1.area.area_id === row.area_id && c1.charge === 80 && a1.status === 201,
          `migrated row: area ${row.area_id} "${row.label}" towns "${row.towns}" charge ${row.charge} active ${row.is_active}, on map ${row.show_on_map} (site map: ${onMap}); charge for a Wallajabad 631605 order: ${c0.area ? c0.area.label : 'no area'} Rs ${c0.charge} (named area too: ${c0id.area ? c0id.area.label : 'no area'}); customer address with it: ${a0.status} ${JSON.stringify(a0.fields)}; trip with it: ${t0.status} "${t0.msg}"; Delivery areas page: active ${areas && areas.is_active}. Admin turns it on: ${on.status}; charge now ${c1.area && c1.area.label} Rs ${c1.charge}; address ${a1.status}; row active ${after.is_active}, on map ${after.show_on_map}, charge ${after.charge}`); }
    } finally {
      await site.close();
    }
    say('site API closed');
  },
};
