import {n64Keyboard} from '../../../web-prototype/shared/n64-keyboard.js';
import {samplePorts,sampleKeyboard} from './input.mjs';
import {useEffect,useRef,useState} from 'react';
export default function NativeGame({src,onClose,soundOn}){
 const [status,setStatus]=useState('Preparing Smash 64…'),[error,setError]=useState(''),[hasFrame,setHasFrame]=useState(false);
 const canvas=useRef(null);
 useEffect(()=>{
  const session=crypto.randomUUID();let closed=false,timer,inputTimer;
  const bridge=window.openSmashDesktop,display=window.meleeDesktop,element=canvas.current,keys=new Set(),pulses=new Set();
  const blocked=()=>[...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some(el=>el.getClientRects().length>0);
  const clear=()=>{keys.clear();pulses.clear();};
  const unsubscribeKeyboard=n64Keyboard.subscribe(clear);
  const key=event=>{if(event.code==='Escape'||event.code==='F11'||event.metaKey)return;event.preventDefault();if(event.type==='keydown'){keys.add(event.code);pulses.add(event.code);}else keys.delete(event.code);};
  const frame=()=>{setHasFrame(true);};
  const focus=()=>{if(!blocked())element.focus({preventScroll:true});};
  const failed=event=>setError(event.detail);
  element.addEventListener('native-frame',frame);element.addEventListener('native-error',failed);
  element.addEventListener('keydown',key);element.addEventListener('keyup',key);element.addEventListener('blur',clear);window.addEventListener('blur',clear);window.addEventListener('focus',focus);
  async function start(){
   try{
    const result=await bridge.launch({engine:'ssb64',session,src,soundOn});if(closed)return;setStatus(result.message);
    display.setGameActive(true);element.focus({preventScroll:true});
    const plan=JSON.parse(new URL(src,location.origin).searchParams.get('ports')||'[null,null,null,null]');
    inputTimer=setInterval(()=>{
     const suspended=blocked(),ports=samplePorts(plan,[...(navigator.getGamepads?.()||[])],suspended);
     if(suspended)clear();else ports.forEach((port,i)=>{if(port[0]===2)ports[i]=sampleKeyboard(new Set([...keys,...pulses]));});
     pulses.clear();bridge.input(session,ports);
    },16);
    const poll=async()=>{try{const state=await bridge.status('ssb64');if(closed)return;setStatus(state.message);if(state.running)timer=setTimeout(poll,500);else{clearInterval(inputTimer);setError(state.message);}}catch(e){if(!closed)setError(e.message);}};void poll();
   }catch(e){if(!closed)setError(e.message);}
  }
  void start();return()=>{closed=true;unsubscribeKeyboard();clearTimeout(timer);clearInterval(inputTimer);clear();display.setGameActive(false);void bridge.stop({engine:'ssb64',session});
   element.removeEventListener('native-frame',frame);element.removeEventListener('native-error',failed);element.removeEventListener('keydown',key);element.removeEventListener('keyup',key);element.removeEventListener('blur',clear);window.removeEventListener('blur',clear);window.removeEventListener('focus',focus);
  };
 },[src]);
 return <section className="ssb64-native-game"><div className="ssb64-native-toolbar"><button onClick={()=>void window.meleeDesktop.fullscreen().then(()=>canvas.current?.focus({preventScroll:true}))}>Fullscreen · F11</button><button onClick={()=>{void window.meleeDesktop.fullscreen(false);onClose();}}>Return to roster</button></div>
  <canvas id="native-game-canvas" ref={canvas} width={960} height={720} tabIndex={0} aria-label="Play Smash 64" onClick={()=>canvas.current?.focus({preventScroll:true})}/>
  {(!hasFrame||error)&&<div className="ssb64-native-message" role={error?'alert':'status'}>{error||status}</div>}
 </section>;
}
