import { useEffect, useState, useSyncExternalStore } from 'react';
import { n64Keyboard } from '../shared/n64-keyboard.js';

export default function N64Keyboard() {
  const bindings = useSyncExternalStore(n64Keyboard.subscribe, n64Keyboard.load, n64Keyboard.load);
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
      if (action) setHeld(current => new Set(current).add(event.code));
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
  }, [bindings, pending]);
  function reset() {
    try { n64Keyboard.save(n64Keyboard.defaults()); setPending(null); setError(''); }
    catch { setError('Could not save your controls. Check that browser storage is available.'); }
  }
  const active = new Set([...held].map(code => n64Keyboard.resolve(code, bindings)));
  return <section className="controls-screen" aria-label="N64 keyboard controls">
    <h3>Keyboard</h3>
    <p>Click a key to rebind it. Press Escape to cancel. Choosing an assigned key swaps the two bindings. Changes apply immediately.</p>
    <dl className="controls-grid settings-keyboard-grid">
      {n64Keyboard.actions.map(({ id, label }) => {
        const code = bindings[id];
        const caption = layout?.get(code)?.toUpperCase().trim() || n64Keyboard.label(code);
        return <div key={id}><dt>{label}</dt><dd><button type="button"
          className={`keycap${pending === id ? ' is-pending' : ''}${active.has(id) ? ' is-pressed' : ''}`}
          aria-label={`${label}: ${caption}. Click to rebind`}
          onClick={() => { setPending(pending === id ? null : id); setError(''); }}
        >{pending === id ? 'Press a key…' : caption}</button></dd></div>;
      })}
    </dl>
    {error && <p role="alert">{error}</p>}
    <div className="controls-actions">
      {pending && <button type="button" onClick={() => { setPending(null); setError(''); }}>Cancel</button>}
      <button type="button" onClick={reset}>Reset keyboard controls</button>
    </div>
  </section>;
}
