import {padLabel,padFamily} from '../../engines/melee/web/lib/controls';
import {editableN64Profile,rebindN64Gamepad} from '../shared/n64-gamepad-bindings.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { padDisplayName } from '../shared/controller-ports.js';
import { n64Keyboard } from '../shared/n64-keyboard.js';

export default function N64Keyboard() {
  const bindings = useSyncExternalStore(n64Keyboard.subscribe, n64Keyboard.load, n64Keyboard.load);
  const remap = window.openSmashControllerRemap;
  const [profile, setProfile] = useState('__default__');
  const [pads, setPads] = useState([]);
  const [padPending, setPadPending] = useState(null);
  const [padHeld, setPadHeld] = useState(new Set());
  const [revision, setRevision] = useState(0);
  const mapping = editableN64Profile(remap?.getProfile(profile));
  function saveMapping(next) {
    if (!remap?.saveProfile(profile, next)) { setError('Could not save your controller profile.'); return; }
    setRevision(value => value + 1); setPadPending(null); setError('');
  }
  useEffect(() => {
    let frame, previous = new Map();
    function poll() {
      const connected = (remap?.rawGamepads() || []).filter(Boolean);
      setPads(current => JSON.stringify(current) === JSON.stringify(connected.map(p=>({id:p.id,index:p.index}))) ? current : connected.map(p=>({id:p.id,index:p.index})));
      const held = new Set();
      for (const pad of connected) {
        if (profile !== '__default__' && pad.id !== profile) continue;
        const before = previous.get(pad.index);
        const pressed = pad.buttons.map(b=>b.pressed || b.value > .5);
        if (padPending && before) {
          const button = pressed.findIndex((v,i)=>v&&!before.buttons[i]);
          const axis = pad.axes.findIndex((v,i)=>Math.abs(v-(before.axes[i]||0)) > .55);
          if (button >= 0 || axis >= 0) {
            const next = rebindN64Gamepad(mapping,padPending,button>=0?button:{index:axis,value:pad.axes[axis],neutral:before.axes[axis]||0});
            saveMapping(next);
          }
        }
        for (const {id} of n64Keyboard.actions) {
          const axis = mapping.axes[id];
          if (mapping.buttons[id] !== undefined ? pressed[mapping.buttons[id]] : axis && (pad.axes[axis.index]-axis.neutral)*Math.sign(axis.value-axis.neutral) > .5) held.add(id);
        }
        previous.set(pad.index,{buttons:pressed,axes:padPending && before ? before.axes : [...pad.axes]});
      }
      setPadHeld(current => [...current].join() === [...held].join() ? current : held);
      frame=requestAnimationFrame(poll);
    }
    frame=requestAnimationFrame(poll);
    return ()=>cancelAnimationFrame(frame);
  }, [profile,padPending,revision]);
  const [pending, setPending] = useState(null);
  const [held, setHeld] = useState(() => new Set());
  const [error, setError] = useState('');
  const [layout, setLayout] = useState(null);
  useEffect(() => {
    let active = true;
    navigator.keyboard?.getLayoutMap?.().then(map => { if (active) setLayout(map); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    function down(event) {
      if (event.metaKey || event.target?.matches('input, select, textarea')) return;
      if (padPending && event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setPadPending(null); return; }
      if (pending) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === 'Escape') { setPending(null); setError(''); return; }
        const next = n64Keyboard.rebind(bindings, pending, event.code);
        if (next === bindings) { setError('Choose a letter, number, arrow key, modifier, Space, or Enter.'); return; }
        try { n64Keyboard.save(next); setPending(null); setError(''); }
        catch { setError('Could not save your controls. Check that browser storage is available.'); }
        return;
      }
      const action = n64Keyboard.resolve(event.code, bindings);
      if (action) { event.preventDefault(); setHeld(current => new Set(current).add(event.code)); }
    }
    const up = event => setHeld(current => { const next = new Set(current); next.delete(event.code); return next; });
    const clear = () => setHeld(new Set());
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', clear);
    };
  }, [bindings, pending, padPending]);
  function reset() {
    try { n64Keyboard.save(n64Keyboard.defaults()); setPending(null); setError(''); }
    catch { setError('Could not save your controls. Check that browser storage is available.'); }
  }
  const family = padFamily((pads.find(p=>p.id===profile)||pads[0])?.id||'');
  const active = new Set([...held].map(code => n64Keyboard.resolve(code, bindings)));
  return <section className="controls-screen" aria-label="N64 controls">
    <p>Click a key or gamepad binding to change it. For gamepad bindings, press a button or move a stick from rest. Press Escape to cancel. Choosing an assigned key swaps the two bindings. Changes apply immediately.</p>
    <p>{pads.length ? `${pads.length} controller${pads.length === 1 ? '' : 's'} connected.` : 'No gamepad detected — connect one and press a button.'}</p>
    <label>Controller profile<select value={profile} onChange={event=>{setProfile(event.target.value);setPadPending(null);}}>
      <option value="__default__">Default for new controllers</option>
      {[...new Set([...pads.map(p=>p.id),...(remap?.profileIds()||[])])].map(id=><option key={id} value={id}>{padDisplayName(id)}</option>)}
    </select><small>Choose a controller to save its own buttons. Controllers of the same model share a profile.</small></label>
    <dl className="controls-grid">
      <div className="controls-head"><dt>Action</dt><dd>Keyboard</dd><dd>Gamepad</dd></div>
      {n64Keyboard.actions.map(({ id, label }) => {
        const code = bindings[id];
        const caption = layout?.get(code)?.toUpperCase().trim() || n64Keyboard.label(code);
        return <div key={id}><dt>{label}</dt><dd><button type="button"
          className={`keycap${pending === id ? ' is-pending' : ''}${active.has(id) ? ' is-pressed' : ''}`}
          aria-label={`${label}: ${caption}. Click to rebind`}
          onClick={() => { setPending(pending === id ? null : id); setPadPending(null); setError(''); }}
        >{pending === id ? 'Press a key…' : caption}</button></dd><dd><button type="button" className={`keycap${padPending === id ? ' is-pending' : ''}${padHeld.has(id) ? ' is-pressed' : ''}`}
          aria-label={`${label} gamepad binding. Click to rebind`} onClick={()=>{setPadPending(padPending===id?null:id);setPending(null);}}>
          {padPending===id ? 'Press a button or move a stick…' : mapping.buttons[id] !== undefined ? padLabel(mapping.buttons[id],family) : mapping.axes[id] ? `Axis ${mapping.axes[id].index+1} ${mapping.axes[id].value > mapping.axes[id].neutral ? '+' : '−'}` : 'Unbound'}
        </button></dd></div>;
      })}
    </dl>
    {error && <p role="alert">{error}</p>}
    <div className="controls-actions">
      {padPending && <button type="button" onClick={()=>setPadPending(null)}>Cancel gamepad binding</button>}
      <button type="button" onClick={()=>{if(remap?.clearProfile(profile)){setRevision(v=>v+1);setPadPending(null);}}}>Reset this controller</button>
      {pending && <button type="button" onClick={() => { setPending(null); setError(''); }}>Cancel</button>}
      <button type="button" onClick={reset}>Reset keyboard controls</button>
    </div>
  </section>;
}
