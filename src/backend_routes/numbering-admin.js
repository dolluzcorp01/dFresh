// Admin > Organisation > Numbering and Admin > Settings > Switches (phase 13, v23 Foundation). Registered from
// Admin_server.js on its route helper (numberingAdmin.register), like foundation.js.
// Numbering (document_series, numbering.js): one row per document with its prefix, format, godown code in the number,
// restart each financial year, the next number per godown and the longest number it can reach. Only an Admin changes
// it, and every change is audited.
// - Built series (already issued on stage2: order, invoice, credit note, return, customer code) keep their pattern:
//   prefix, per godown and restart each year are refused "kept as built". Their next number may still be raised.
// - A GST document keeps its own run per godown and restarts each financial year (v23).
// - A prefix whose longest number would pass the limit (GST: 16 characters) is refused with that number; a prefix is
//   unique across documents (Receipt DFRC never clashes with Return DFR).
// - Next number: only up, never to or below the last number used, never past the digits (0001 to 9999).
// - "Test: use next number" (v23 test 0.27) uses one number for good; it exists outside production only.
// Switches (commerce_settings rows with sw_group): grouped like Company; each with its about, an example, on / off, a
// choice, or a number with its unit and its allowed min and max (second-admin.js RANGE). They are saved through
// PUT /commerce-settings/:key, which enforces the range and holds a loosening for a second Admin (second-admin.js).
const { audit } = require('./audit');
const numbering = require('./numbering');
const secondAdmin = require('./second-admin');
const commerceSettings = require('./commerce-settings');

const SW_GROUPS = ['Turn on', 'Stock', 'Orders', 'Delivery', 'Money', 'Wallet', 'Returns', 'Approvals', 'System'];
const PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const FMT_TEXT = { slash: 'PREFIX/26-27/0001', year: 'PREFIX-260001', plain: 'PREFIX-0001' };

function register({ route, tx, db, by, InputError, canDo }) {
  const isAdmin = (req) => Boolean(req.admin && req.admin.is_admin);
  const mayEdit = (req) => isAdmin(req) && canDo(req, 'settings', 'edit');
  const mustEdit = (req) => { if (!mayEdit(req)) throw new InputError('Only an Admin changes numbering', 403); };
  const godownList = async (q) => {
    const [rows] = await q.query('SELECT location_id AS godown_id, code, name, in_number, is_active FROM locations ORDER BY sort_order, location_id');
    return rows.map((g) => ({ ...g, in_number: Number(g.in_number) === 1, is_active: Number(g.is_active) === 1 }));
  };
  /** the runs of a series today: one per open godown when per godown, else one -> [{ godown_id, code, name, last, next, no, key }] */
  async function runsOf(q, s, godowns) {
    const open = godowns.filter((g) => g.is_active);
    const list = s.fmt === 'slash' && s.per_godown ? open : [null];
    const out = [];
    for (const g of list) {
      const p = await numbering.peek(q, s, g ? { code: g.code, coded: g.in_number } : { code: '', coded: false });
      out.push({ godown_id: g ? g.godown_id : null, code: g ? g.code : null, name: g ? g.name : null, ...p });
    }
    return out;
  }
  async function seriesOut(q, s, godowns) {
    const runs = await runsOf(q, s, godowns);
    const longest = numbering.longestOf(s, godowns.filter((g) => g.is_active));
    return { ...s, runs, longest, length: Math.max(...runs.map((r) => r.no.length)), too_long: numbering.tooLong(s, longest) ? `${longest} is ${longest.length} characters. ${numbering.tooLong(s, longest)}.` : '', pattern: FMT_TEXT[s.fmt] };
  }
  const builtRefusal = (s, runs) => `${s.label} numbers already run on stage2 (${runs[0].no}). Changing the pattern would break the running series, so it stays.`;

  route('get', '/numbering', 'settings:view', async (req) => {
    const godowns = await godownList(db);
    const series = [];
    for (const s of await numbering.seriesList(db)) series.push(await seriesOut(db, s, godowns));
    return { series, godowns: godowns.filter((g) => g.is_active), fy: numbering.fyOf(new Date()), can_edit: mayEdit(req), test_tool: process.env.NODE_ENV !== 'production' };
  });

  // prefix, per godown, restart each year (one or more in the body)
  route('put', '/numbering/:doc', 'settings:edit', async (req) => tx(async (q) => {
    mustEdit(req);
    const s = await numbering.seriesOf(q, req.params.doc, true);
    if (!s) throw new InputError('No such document', 404);
    const godowns = await godownList(q);
    const b = req.body || {};
    const want = {
      prefix: b.prefix === undefined ? s.prefix : String(b.prefix).trim().toUpperCase(),
      per_godown: b.per_godown === undefined ? s.per_godown : Boolean(Number(b.per_godown)),
      fy_reset: b.fy_reset === undefined ? s.fy_reset : Boolean(Number(b.fy_reset)),
    };
    const changed = Object.keys(want).filter((k) => want[k] !== s[k]);
    if (!changed.length) return { doc_key: s.doc_key, saved: false };
    if (s.built) throw new InputError(`Kept as built. ${builtRefusal(s, await runsOf(q, s, godowns))}`, 409);
    if (changed.includes('per_godown')) {
      if (s.fmt !== 'slash') throw new InputError(`${s.label} numbers have no godown code`);
      if (s.gst && !want.per_godown) throw new InputError(`Kept per godown. ${s.label} is a GST document: each godown keeps its own unbroken run.`, 409);
    }
    if (changed.includes('fy_reset')) {
      if (s.fmt !== 'slash') throw new InputError(s.fmt === 'year' ? `${s.label} numbers restart each calendar year` : `${s.label} codes never restart`);
      if (s.gst && !want.fy_reset) throw new InputError('Kept. GST documents restart every financial year.', 409);
    }
    if (changed.includes('prefix')) {
      if (!want.prefix) throw new InputError('A prefix cannot be empty.');
      if (!PREFIX_RE.test(want.prefix)) throw new InputError(`Prefix: 2 to 6 capital letters or digits, starting with a letter. Kept ${s.prefix}.`);
      const [[dup]] = await q.query('SELECT label FROM document_series WHERE prefix = ? AND doc_key <> ?', [want.prefix, s.doc_key]);
      if (dup) throw new InputError(`${want.prefix} is already used by ${dup.label}. Kept ${s.prefix}.`, 409);
    }
    const next = { ...s, ...want };
    const longest = numbering.longestOf(next, godowns.filter((g) => g.is_active));
    const why = numbering.tooLong(next, longest);
    if (why) throw new InputError(`With ${want.prefix} the longest number would be ${longest}, ${longest.length} characters. ${why}. Kept ${s.prefix}.`);
    await q.query('UPDATE document_series SET prefix = ?, per_godown = ?, fy_reset = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE doc_key = ?',
      [want.prefix, want.per_godown ? 1 : 0, want.fy_reset ? 1 : 0, by(req), s.doc_key]);
    await audit(q, { empId: by(req), action: 'update', entity: 'document_series', entityId: s.doc_key,
      before: { prefix: s.prefix, per_godown: s.per_godown, fy_reset: s.fy_reset }, after: want });
    const out = await seriesOut(q, next, godowns);
    return { doc_key: s.doc_key, saved: true, message: `${s.label} now starts ${out.runs.map((r) => r.no).join(' / ')}.` };
  }));

  // next number of one run (a godown's, when per godown): only up
  route('put', '/numbering/:doc/next', 'settings:edit', async (req) => tx(async (q) => {
    mustEdit(req);
    const s = await numbering.seriesOf(q, req.params.doc, true);
    if (!s) throw new InputError('No such document', 404);
    const b = req.body || {};
    const raw = String(b.next ?? '').trim();
    if (!/^\d{1,9}$/.test(raw)) throw new InputError('Next number: a whole number');
    const want = Number(raw);
    const godowns = await godownList(q);
    let g = null;
    if (s.fmt === 'slash' && s.per_godown) {
      g = godowns.find((x) => x.godown_id === Number(b.godown_id) && x.is_active);
      if (!g) throw new InputError('Choose the godown whose next number this is');
    }
    const c = numbering.compose(s, g ? { code: g.code, coded: g.in_number } : { code: '', coded: false }, new Date());
    const [[row]] = await q.query('SELECT last_no FROM number_series WHERE series_key = ? FOR UPDATE', [c.key]);
    const last = row ? Number(row.last_no) : 0;
    const now = row ? last + 1 : c.start;
    const top = 10 ** s.digits - 1;
    if (want === now) return { doc_key: s.doc_key, saved: false };
    if (want <= last) throw new InputError(`${c.no(last)} is already used: the next number must be after it (${c.no(last + 1)} or later). A number is never issued twice.`, 409);
    if (want < 1) throw new InputError('Next number: 1 or more');
    if (want > top) throw new InputError(`At most ${c.no(top)}: ${s.label} numbers have ${s.digits} digits.`);
    if (row) await q.query('UPDATE number_series SET last_no = ? WHERE series_key = ?', [want - 1, c.key]);
    else await q.query('INSERT INTO number_series (series_key, last_no) VALUES (?, ?)', [c.key, want - 1]);
    await audit(q, { empId: by(req), action: 'update', entity: 'number_series', entityId: c.key, before: { next: c.no(now) }, after: { next: c.no(want) } });
    return { doc_key: s.doc_key, saved: true, message: `${s.label}${g ? ` (${g.name})` : ''}: the next number is ${c.no(want)}.` };
  }));

  // v23 test tool: use the next number now (outside production only)
  route('post', '/numbering/:doc/issue', 'settings:edit', async (req) => tx(async (q) => {
    mustEdit(req);
    if (process.env.NODE_ENV === 'production') throw new InputError('Not on the live admin: a number is taken only when a document is made', 404);
    const s = await numbering.seriesOf(q, req.params.doc);
    if (!s) throw new InputError('No such document', 404);
    const godowns = await godownList(q);
    let g = null;
    if (s.fmt === 'slash' && s.per_godown) g = godowns.find((x) => x.godown_id === Number((req.body || {}).godown_id) && x.is_active) || godowns.find((x) => x.is_active);
    const gd = g ? { code: g.code, in_number: g.in_number ? 1 : 0 } : null;
    const peek = await numbering.sampleFor(q, s.doc_key, gd);
    const why = numbering.tooLong(s, peek);
    if (why) throw new InputError(`Not issued. ${peek} is ${peek.length} characters; ${why}. Shorten the prefix.`);
    const no = await numbering.issue(q, s.doc_key, gd);
    const after = await numbering.sampleFor(q, s.doc_key, gd);
    await audit(q, { empId: by(req), action: 'create', entity: 'number_series', entityId: s.doc_key, after: { issued: no, test: true } });
    return { issued: no, next: after, message: `${no} issued. The next one is ${after}. If this document is cancelled, ${no} is marked cancelled, never handed out again.` };
  }));

  // ------------------------------------------------------------------------------------------------- switches
  route('get', '/switches', 'settings:view', async (req) => {
    const [rows] = await db.query(
      `SELECT setting_key, label, help, value, value_type, options, tbc, sw_group, sw_unit, sw_example, sw_sort, updated_by, updated_at
         FROM commerce_settings WHERE sw_group IS NOT NULL ORDER BY sw_sort, setting_key`);
    const [waits] = await db.query(
      `SELECT approval_id, summary, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) AS dk FROM approvals
        WHERE kind = 'rule_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.t')) = 'switch'`);
    const switches = rows.map((r) => {
      const range = secondAdmin.RANGE[r.setting_key] || null;
      const w = waits.find((x) => x.dk === `switch:${r.setting_key}`);
      const fx = commerceSettings.fixedOf(r.setting_key); // decided by the code: shown read only with where it comes from
      return {
        key: r.setting_key, label: r.label, about: r.help, example: r.sw_example, group: r.sw_group, type: r.value_type, value: fx ? fx.value : r.value,
        fixed_from: fx ? fx.from : null,
        server_note: r.setting_key === 'notify_email' && process.env.MAIL_ENABLED !== 'true' ? 'This server sends no e-mail at all: MAIL_ENABLED is off in its settings (set on the server by the developer).' : null,
        options: r.options ? JSON.parse(r.options) : null, unit: r.sw_unit, min: range ? range[0] : null, max: range ? range[1] : null,
        loosens: secondAdmin.LOOSEN[r.setting_key] || null, tbc: Number(r.tbc) === 1, updated_by: r.updated_by, updated_at: r.updated_at,
        waiting: w ? { approval_id: w.approval_id, summary: w.summary } : null,
      };
    });
    const groups = [...SW_GROUPS.filter((g) => switches.some((s) => s.group === g)), ...[...new Set(switches.map((s) => s.group))].filter((g) => !SW_GROUPS.includes(g))];
    return { groups, switches, can_edit: mayEdit(req) };
  });
}

module.exports = { register, SW_GROUPS };
