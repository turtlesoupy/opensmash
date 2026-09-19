import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {transformWithOxc} from 'vite';
import * as controls from '../../engines/melee/web/lib/controls.ts';
import * as help from './controller-help.js';

const source=await readFile(new URL('../../engines/melee/web/app/Controls.tsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\n/gm,''),'Controls.tsx',{jsx:{runtime:'classic'}});
function harness(initialPads=[]){
 let pads=initialPads,cursor=0,tree;
 const slots=[],effects=[],frames=new Map();let frame=0;
 const context={...controls,...help,desktop:()=>null,
  connectedGamepads:()=>pads,
  window:{addEventListener(){},removeEventListener(){}},
  requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id),
  React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})},
  useSyncExternalStore:()=>controls.defaults(),
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 vm.createContext(context);
 vm.runInContext(code.replace('export default function Controls','function Controls')+'\nthis.Component=Controls;',context);
 function render(){cursor=0;tree=context.Component();effects.splice(0).forEach(fn=>fn());}
 function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of node.children||[]){const match=find(child,predicate);if(match)return match;}return null;}
 render();
 return {
  get profile(){return find(tree,n=>n.type==='select').props.value;},
  select(value){find(tree,n=>n.type==='select').props.onChange({target:{value}});render();},
  poll(nextPads){pads=nextPads;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());render();},
 };
}
const pad=id=>({id,connected:true,buttons:[],axes:[]});
test('settings selects a connected controller and follows replacement until explicitly selected',()=>{
 const h=harness([pad('Xbox')]);assert.equal(h.profile,'Xbox');
 h.poll([pad('Sony')]);assert.equal(h.profile,'Sony');
});
test('a controller revealed after opening settings becomes the edit target',()=>{
 const h=harness();assert.equal(h.profile,'');
 h.poll([pad('Xbox')]);assert.equal(h.profile,'Xbox');
});
test('explicit defaults and controller selections survive polling and disconnects',()=>{
 const h=harness([pad('Xbox'),pad('Sony')]);
 h.select('');h.poll([pad('Xbox')]);assert.equal(h.profile,'');
 h.select('Sony');h.poll([pad('Xbox')]);assert.equal(h.profile,'Sony');
});
