// Masters > Partners > Vehicles and drivers, Couriers; Masters > Tax and units > Delivery areas (phase 20, v23 viewVehicles /
// viewCouriers / viewAreas, DRAWERS.veh / drv / cour / area; API /fulfil/vehicles|drivers|couriers|areas in fulfil-routes.js).
// A vehicle carries up to its kg and boxes (checked when a trip is loaded); its insurance and fitness, and the driver's
// licence, are checked when a trip starts ("Soon" 30 days before). A delivery area has its PIN codes (or towns), the
// godown it is served from, the days we go and its delivery charge. "Show on the website map" is kept with the area; the
// map on the website itself stays as set in Website (it keeps working unchanged).
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, LIcon, Loading, PageHead, Pill, Table, money, useAction, useLoad, useToast } from './ui';
import { In, fieldsOf } from './buyShared';

const dateCell = (d, soon) => (d ? <>{d}{d < new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) ? <> <Pill tone="bad">Ended</Pill></> : soon ? <> <Pill tone="warn">Soon</Pill></> : null}</> : '-');
function useSaver(onSaved) {
  const act = useAction();
  const toast = useToast();
  const [err, setErr] = useState({});
  const save = (method, path, body, title, text) => act.run(async () => {
    setErr({});
    try { await api.send(method, path, body); toast('good', title, text); onSaved(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return { act, err, save };
}
const foot = (ed, onClose, busy, onSave) => <><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{ed ? 'Cancel' : 'Close'}</button>
  {ed && <button type="button" className="a-btn" disabled={busy} onClick={onSave}><LIcon name="check" size="sm" />Save</button>}</>;

// ---------------------------------------------------------------------------------------------------- Vehicles and drivers
export function Vehicles() {
  const data = useLoad('/fulfil/vehicles');
  const [veh, setVeh] = useState(null);
  const [drv, setDrv] = useState(null);
  const d = data.data;
  const ed = Boolean(d && d.can.edit);
  const vcols = [
    { key: 'number', label: 'Vehicle', render: (v) => <><b className="a-mono">{v.number}</b><small className="a-muted a-p15-sub">{v.type}</small></> },
    { key: 'godown', label: 'Godown', render: (v) => v.godown || '-' },
    { key: 'carries', label: 'Carries', num: true, render: (v) => (v.max_kg !== null ? <>{Number(v.max_kg)} kg<small className="a-muted a-p15-sub">{v.max_boxes} boxes</small></> : '-') },
    { key: 'ins', label: 'Insurance', render: (v) => dateCell(v.insurance_until, v.ins_soon) },
    { key: 'fc', label: 'Fitness (FC)', render: (v) => dateCell(v.fitness_until, v.fc_soon) },
    { key: 'state', label: 'State', render: (v) => (!v.is_active ? <Pill>Not in use</Pill> : v.problems.length ? <Pill tone="bad" title={v.problems.join(', ')}>Cannot go out</Pill> : <Pill tone="good">Ready</Pill>) },
  ];
  const dcols = [
    { key: 'name', label: 'Driver', render: (x) => <><b>{x.name}</b><small className="a-muted a-p15-sub">{x.phone}</small></> },
    { key: 'user', label: 'Admin user', render: (x) => x.emp_id || <span className="a-muted">not linked</span> },
    { key: 'lic', label: 'Licence', render: (x) => <span className="a-mono">{x.licence_no || '-'}</span> },
    { key: 'until', label: 'Valid until', render: (x) => <>{x.licence_until || '-'}{x.problem && <> <Pill tone="bad">{x.problem}</Pill></>}</> },
  ];
  return (
    <section>
      <PageHead sub="Our own delivery fleet" rules={['Capacity checked when loading', 'Insurance and fitness checked when a trip starts', 'Drivers are linked to an admin user']}
        actions={ed && <button type="button" className="a-btn" onClick={() => setVeh('new')}><LIcon name="plus" size="sm" />New vehicle</button>} />
      <Loading state={data}>{d && <>
        <div className="a-card a-p20-card"><div className="a-card-h"><h2>Vehicles</h2></div><Table columns={vcols} rows={d.vehicles} rowKey={(v) => v.vehicle_id} label="Vehicles" onRowClick={(v) => setVeh(v)} empty={{ icon: 'truck', title: 'No vehicle yet' }} /></div>
        <div className="a-card a-p20-card"><div className="a-card-h"><h2>Drivers</h2><span className="a-p15-sp" /><span className="a-hint-s">Add a driver in Commerce settings &gt; Drivers</span></div>
          <Table columns={dcols} rows={d.drivers} rowKey={(x) => x.driver_id} label="Drivers" onRowClick={(x) => setDrv(x)} empty={{ icon: 'user', title: 'No driver yet' }} /></div>
      </>}</Loading>
      {veh && d && <VehicleDrawer v={veh === 'new' ? null : veh} godowns={d.godowns} ed={ed} onClose={() => setVeh(null)} onSaved={() => { setVeh(null); data.reload(); }} />}
      {drv && <DriverDrawer x={drv} ed={ed} onClose={() => setDrv(null)} onSaved={() => { setDrv(null); data.reload(); }} />}
    </section>
  );
}
function VehicleDrawer({ v, godowns, ed, onClose, onSaved }) {
  const s = useSaver(onSaved);
  const [f, setF] = useState({ number: v ? v.number : '', type: v ? v.type : '', godown_id: String(v ? v.godown_id || '' : (godowns[0] || {}).godown_id || ''), max_kg: v && v.max_kg !== null ? String(Number(v.max_kg)) : '', max_boxes: v && v.max_boxes !== null ? String(v.max_boxes) : '',
    insurance_until: v ? v.insurance_until || '' : '', fitness_until: v ? v.fitness_until || '' : '', is_active: v ? (v.is_active ? '1' : '0') : '1', notes: v ? v.notes || '' : '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = () => s.save(v ? 'PUT' : 'POST', v ? `/fulfil/vehicles/${v.vehicle_id}` : '/fulfil/vehicles', { ...f, number: f.number.toUpperCase(), is_active: f.is_active === '1' }, 'Saved', `${f.number.toUpperCase()} saved.`);
  return (
    <Drawer title={v ? v.number : 'New vehicle'} onClose={onClose} thumb={<LIcon name="truck" />} footer={foot(ed, onClose, s.act.busy, go)}>
      {s.act.note}
      <div className="a-grid2">
        <In label="Number plate *" value={f.number} disabled={Boolean(v) || !ed} className="a-mono" error={s.err.number} hint="Like TN 21 BC 4417. Never changes once saved." maxLength={16} onChange={set('number')} />
        <In label="Type *" value={f.type} disabled={!ed} error={s.err.type} maxLength={40} onChange={set('type')} />
        <In label="Godown *" error={s.err.godown_id}><select value={f.godown_id} disabled={!ed} onChange={set('godown_id')}>{godowns.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="Carries up to (kg) *" type="number" min="1" step="1" value={f.max_kg} disabled={!ed} error={s.err.max_kg} onChange={set('max_kg')} />
        <In label="Carries up to (boxes) *" type="number" min="1" step="1" value={f.max_boxes} disabled={!ed} error={s.err.max_boxes} onChange={set('max_boxes')} />
        <In label="Insurance valid until *" type="date" value={f.insurance_until} disabled={!ed} error={s.err.insurance_until} onChange={set('insurance_until')} />
        <In label="Fitness certificate until" type="date" value={f.fitness_until} disabled={!ed} error={s.err.fitness_until} hint="Not needed for a two-wheeler." onChange={set('fitness_until')} />
        <In label="In use *"><select value={f.is_active} disabled={!ed} onChange={set('is_active')}><option value="1">Yes</option><option value="0">No</option></select></In>
        <In label="Notes" wide value={f.notes} disabled={!ed} maxLength={100} onChange={set('notes')} />
      </div>
    </Drawer>
  );
}
function DriverDrawer({ x, ed, onClose, onSaved }) {
  const s = useSaver(onSaved);
  const [f, setF] = useState({ licence_no: x.licence_no || '', licence_until: x.licence_until || '' });
  const go = () => s.save('PUT', `/fulfil/drivers/${x.driver_id}`, f, 'Saved', `${x.name}: licence saved.`);
  return (
    <Drawer title={x.name} onClose={onClose} thumb={<LIcon name="user" />} footer={foot(ed, onClose, s.act.busy, go)}>
      {s.act.note}
      <div className="a-grid2">
        <In label="Driving licence number *" className="a-mono" value={f.licence_no} disabled={!ed} error={s.err.licence_no} maxLength={20} onChange={(e) => setF({ ...f, licence_no: e.target.value })} />
        <In label="Valid until *" type="date" value={f.licence_until} disabled={!ed} error={s.err.licence_until} hint="A driver with an ended licence cannot start a trip." onChange={(e) => setF({ ...f, licence_until: e.target.value })} />
      </div>
      <dl className="a-kv"><dt>Phone</dt><dd>{x.phone || '-'}</dd><dt>Admin user</dt><dd>{x.emp_id || 'not linked'} <small className="a-muted">(set in Commerce settings &gt; Drivers)</small></dd></dl>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Couriers
export function Couriers() {
  const data = useLoad('/fulfil/couriers');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const ed = Boolean(d && d.can.edit);
  const cols = [
    { key: 'name', label: 'Courier', render: (c) => <b>{c.name}</b> },
    { key: 'phone', label: 'Phone', render: (c) => c.phone || '-' },
    { key: 'kg', label: 'Per kg', num: true, render: (c) => (c.per_kg === null ? '-' : money(c.per_kg)) },
    { key: 'min', label: 'Minimum', num: true, render: (c) => (c.min_charge === null ? '-' : money(c.min_charge)) },
    { key: 'st', label: 'State', render: (c) => (c.is_active ? <Pill tone="good">In use</Pill> : <Pill>Not in use</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="Outside delivery companies" rules={['Charge worked out from the weight', 'Tracking link from the AWB']}
        actions={ed && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New courier</button>} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(c) => c.courier_id} label="Couriers" onRowClick={(c) => setOpen(c)} empty={{ icon: 'send', title: 'No courier yet' }} /></div>}</Loading>
      {open && <CourierDrawer c={open === 'new' ? null : open} ed={ed} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}
function CourierDrawer({ c, ed, onClose, onSaved }) {
  const s = useSaver(onSaved);
  const [f, setF] = useState({ name: c ? c.name : '', phone: c ? c.phone || '' : '', per_kg: c && c.per_kg !== null ? String(c.per_kg) : '', min_charge: c && c.min_charge !== null ? String(c.min_charge) : '', tracking_url: c ? c.tracking_url || '' : '', is_active: c ? (c.is_active ? '1' : '0') : '1' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = () => s.save(c ? 'PUT' : 'POST', c ? `/fulfil/couriers/${c.courier_id}` : '/fulfil/couriers', { ...f, is_active: f.is_active === '1' }, 'Saved', `${f.name} saved.`);
  return (
    <Drawer title={c ? c.name : 'New courier'} onClose={onClose} thumb={<LIcon name="send" />} footer={foot(ed, onClose, s.act.busy, go)}>
      {s.act.note}
      <div className="a-grid2">
        <In label="Name *" value={f.name} disabled={!ed} error={s.err.name} maxLength={60} onChange={set('name')} />
        <In label="Phone *" value={f.phone} disabled={!ed} error={s.err.phone} onChange={set('phone')} />
        <In label="Charge per kg (Rs) *" type="number" min="0" step="1" value={f.per_kg} disabled={!ed} error={s.err.per_kg} onChange={set('per_kg')} />
        <In label="Minimum charge (Rs) *" type="number" min="0" step="1" value={f.min_charge} disabled={!ed} error={s.err.min_charge} onChange={set('min_charge')} />
        <In label="Tracking link" wide value={f.tracking_url} disabled={!ed} error={s.err.tracking_url} placeholder="https://.../track?awb={awb}" hint="{awb} is replaced by the docket number." onChange={set('tracking_url')} />
        <In label="In use *"><select value={f.is_active} disabled={!ed} onChange={set('is_active')}><option value="1">Yes</option><option value="0">No</option></select></In>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------- Delivery areas
export function DeliveryAreas() {
  const data = useLoad('/fulfil/areas');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const ed = Boolean(d && d.can.edit);
  const cols = [
    { key: 'label', label: 'Town / area', render: (a) => <><b>{a.label}</b>{!a.is_active && <small className="a-p15-sub"><Pill>Not in use</Pill></small>}</> },
    { key: 'pins', label: 'PIN codes', render: (a) => <span className="a-mono">{[...a.pins, ...a.towns_only].join(', ') || '-'}</span> },
    { key: 'from', label: 'From', render: (a) => a.godown || '-' },
    { key: 'days', label: 'Days', render: (a) => (a.days.length === 7 ? 'Every day' : a.days.join(', ')) },
    { key: 'charge', label: 'Delivery charge', num: true, render: (a) => (a.charge ? money(a.charge) : 'Free') },
    { key: 'n', label: 'Customers', num: true, render: (a) => a.customers },
    { key: 'web', label: 'Website map', render: (a) => (a.show_on_map ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="Towns we deliver to; can show on the website map" rules={['Sets the delivery charge on an order', 'Days we go there', 'Can show on the website map']}
        actions={ed && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New area</button>} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(a) => a.area_id} label="Delivery areas" onRowClick={(a) => setOpen(a)} empty={{ icon: 'map-pin', title: 'No area yet' }} /></div>}</Loading>
      {open && d && <AreaDrawer a={open === 'new' ? null : open} d={d} ed={ed} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}
function AreaDrawer({ a, d, ed, onClose, onSaved }) {
  const s = useSaver(onSaved);
  const toast = useToast();
  const [f, setF] = useState({ label: a ? a.label : '', towns: a ? [...a.towns_only, ...a.pins].join(', ') : '', godown_id: String(a ? a.godown_id || '' : (d.godowns[0] || {}).godown_id || ''), charge: a ? String(a.charge || 0) : '0',
    free_above: a && a.free_above !== null ? String(a.free_above) : '', days: a ? a.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], show_on_map: a ? (a.show_on_map ? '1' : '0') : '1', is_active: a ? (a.is_active ? '1' : '0') : '1' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const day = (k) => setF((x) => ({ ...x, days: x.days.includes(k) ? x.days.filter((y) => y !== k) : [...x.days, k] }));
  const go = () => { if (!f.days.length) { toast('bad', 'Pick the days', 'At least one day we go there.'); return; }
    s.save(a ? 'PUT' : 'POST', a ? `/fulfil/areas/${a.area_id}` : '/fulfil/areas', { ...f, godown_id: f.godown_id || null, show_on_map: f.show_on_map === '1', is_active: f.is_active === '1' }, 'Saved', `${f.label} saved.`); };
  return (
    <Drawer title={a ? a.label : 'New delivery area'} onClose={onClose} thumb={<LIcon name="map-pin" />} footer={foot(ed, onClose, s.act.busy, go)}>
      {s.act.note}
      <div className="a-grid2">
        <In label="Town or area *" value={f.label} disabled={!ed} error={s.err.label} maxLength={40} hint='Matches the "Delivery area" on a customer address.' onChange={set('label')} />
        <In label="PIN codes *" className="a-mono" value={f.towns} disabled={!ed} error={s.err.towns} hint="Separated by commas (town names may be added too)." onChange={set('towns')} />
        <In label="Served from *"><select value={f.godown_id} disabled={!ed} onChange={set('godown_id')}>{d.godowns.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="Delivery charge (Rs, no GST) *" type="number" min="0" step="10" value={f.charge} disabled={!ed} error={s.err.charge} hint="0 = free. Fills the charge on new orders; it can be changed on the order." onChange={set('charge')} />
        <In label="Free above (Rs)" type="number" min="0" step="100" value={f.free_above} disabled={!ed} hint="Order value from which delivery is free; empty = never." onChange={set('free_above')} />
        <In label="In use *"><select value={f.is_active} disabled={!ed} onChange={set('is_active')}><option value="1">Yes</option><option value="0">No</option></select></In>
        <div className="a-field a-wide"><span>Days we go *</span><div className="a-p20-days">{d.days.map((k) => <label key={k} className="a-chkrow"><input type="checkbox" checked={f.days.includes(k)} disabled={!ed} onChange={() => day(k)} /><span>{k}</span></label>)}</div>{s.err.days && <small className="a-err">{s.err.days}</small>}</div>
        <In label="Show on the website map *" hint="Kept with the area. The map on the website itself is set in Website and keeps working as it is."><select value={f.show_on_map} disabled={!ed} onChange={set('show_on_map')}><option value="1">Yes</option><option value="0">No</option></select></In>
      </div>
    </Drawer>
  );
}
