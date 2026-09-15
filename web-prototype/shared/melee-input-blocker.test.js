import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameInputBlocker} from '../../engines/melee/web/lib/input-blocker.ts';

function fixture(t) {
  const previous = globalThis.MutationObserver;
  let observer, queries = 0;
  const elements = [];
  globalThis.MutationObserver = class {
    records = [];
    disconnected = false;
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    takeRecords() { return this.records.splice(0); }
    disconnect() { this.disconnected = true; }
  };
  t.after(() => { globalThis.MutationObserver = previous; });
  const blocker = createGameInputBlocker({
    querySelectorAll() {
      queries++;
      return elements.filter(element => element.localName === 'dialog' || element.getAttribute('role') === 'dialog');
    },
  });
  t.after(() => blocker.dispose());
  return {blocker, elements, get observer() { return observer; }, get queries() { return queries; }};
}

function element(localName, attributes = {}) {
  return {
    localName, attributes, visible: true,
    hasAttribute(name) { return name in this.attributes; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    getClientRects() { return this.visible ? [{}] : []; },
  };
}

test('modal open state and visibility stay live without rescanning the roster', t => {
  const f = fixture(t), dialog = element('dialog');
  f.elements.push(dialog);
  assert.equal(f.blocker.isBlocked(), false);
  dialog.attributes.open = '';
  assert.equal(f.blocker.isBlocked(), true);
  dialog.visible = false;
  assert.equal(f.blocker.isBlocked(), false);
  dialog.visible = true;
  delete dialog.attributes.open;
  assert.equal(f.blocker.isBlocked(), false);
  for (let frame = 0; frame < 120; frame++) f.blocker.isBlocked();
  assert.equal(f.queries, 1);
});

test('new, removed and repurposed dialogs update before the next input event', t => {
  const f = fixture(t), dialog = element('div', {role: 'dialog', 'aria-modal': 'true'});
  assert.equal(f.blocker.isBlocked(), false);
  f.elements.push(dialog);
  f.observer.records.push({type: 'childList'});
  assert.equal(f.blocker.isBlocked(), true);
  dialog.attributes['aria-modal'] = 'false';
  assert.equal(f.blocker.isBlocked(), false);
  dialog.attributes['aria-modal'] = 'true';
  dialog.attributes.role = 'region';
  f.observer.records.push({type: 'attributes'});
  assert.equal(f.blocker.isBlocked(), false);
  dialog.attributes.role = 'dialog';
  f.observer.callback([{type: 'attributes'}]);
  assert.equal(f.blocker.isBlocked(), true);
  f.elements.length = 0;
  f.observer.records.push({type: 'childList'});
  assert.equal(f.blocker.isBlocked(), false);
});

test('closing the game disconnects observation and releases cached elements', t => {
  const f = fixture(t);
  f.elements.push(element('dialog', {open: ''}));
  assert.equal(f.blocker.isBlocked(), true);
  f.blocker.dispose();
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.blocker.isBlocked(), false);
  assert.equal(f.queries, 1);
});
