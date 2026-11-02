// The Godown select of the forms that put something in one godown (phase 12a): Stock in, Write-off, Record move,
// New count, New customer and the customer drawer. It offers the godowns the person works at (me.godown_list, the
// API refuses any other) and starts on the header picker's godown, else the first. One godown: shown, not a choice.
import { useState } from 'react';
import { useAdmin } from './ui/context';
import { savedGodown } from './HeaderBar';

/** [godownId, setGodownId, list]: the starting godown for a new record */
export function useGodown(initial = null) {
  const { me } = useAdmin();
  const list = (me && me.godown_list) || [];
  const [id, setId] = useState(() => String(initial || savedGodown(me) || (list[0] && list[0].godown_id) || ''));
  return [id, setId, list];
}

export default function GodownField({ value, onChange, list, label = 'Godown', disabled = false }) {
  if (list.length <= 1) {
    return <label className="a-field"><span>{label}</span><input value={list[0] ? list[0].name : 'No godown'} readOnly aria-label={label} /></label>;
  }
  return (
    <label className="a-field"><span>{label}</span>
      <select value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {list.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}
      </select></label>
  );
}
