/** Worker-compatible launcher adapter for browser-owned WebGPU rendering. */
export class MeleeFrameWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  frame: HTMLIFrameElement;
  pending: unknown[];
  listener: (event: MessageEvent) => void;
  private pads = new Map<number, number[]>();
  private diagnostics: string[] = [];
  connected = false;
  closed = false;
  private bridgeTimer: ReturnType<typeof setTimeout>;
  resize?: ResizeObserver;
  surface?: HTMLCanvasElement;
  constructor(url: string, surface?: HTMLCanvasElement) {
    super();
    this.frame = document.createElement('iframe');
    this.frame.title = 'Melee engine';
    // Input belongs to the launcher; tabbing into the renderer loses key events.
    this.frame.tabIndex = -1;
    Object.assign(this.frame.style,{position:'fixed',left:'-20000px',top:'0',width:'960px',height:'720px',border:'0'});
    this.pending=[];
    this.listener=event=>{
      if(event.source!==this.frame.contentWindow||event.origin!==location.origin)return;
      if(event.data?.type==='bridge-ready'){
        clearTimeout(this.bridgeTimer);this.connected=true;for(const data of this.pending)this.postMessage(data);this.pending=[];return;
      }
      let data=event.data;
      if(data?.type==='log'){
        this.diagnostics.push(String(data.text||data.message||'').slice(-2000));
        if(this.diagnostics.length>12)this.diagnostics.shift();
      }
      if(data?.type==='error'){
        const reason=typeof data.message==='string'&&data.message.trim()?data.message:'Melee initialization failed without an error message.';
        const details=this.diagnostics.join('\n');
        const gpuFailure=/WebGPU|requestAdapter|requestDevice/i.test(reason+'\n'+details);
        const help=gpuFailure?'Melee could not initialize WebGPU. Check browser hardware acceleration and graphics driver support. ':'';
        data={...data,message:help+reason+(details?'\nRecent engine output:\n'+details:'')};
      }
      const message=new MessageEvent('message',{data});
      this.dispatchEvent(message);this.onmessage?.(message);
    };
    this.bridgeTimer=setTimeout(()=>{
      if(this.closed||this.connected)return;
      const message=new MessageEvent('message',{data:{type:'error',message:'The Melee engine page did not initialize within 30 seconds. Reload and try again; an engine script may have failed to load.'}});
      this.dispatchEvent(message);this.onmessage?.(message);
    },30000);
    window.addEventListener('message',this.listener);
    this.frame.src=url;
    if(surface?.parentElement)surface.parentElement.insertBefore(this.frame,surface);
    else document.body.append(this.frame);
  }
  attachSurface(canvas: HTMLCanvasElement){
    const parent=canvas.parentElement as (HTMLElement & {moveBefore?: (node:Node,child:Node|null)=>void})|null;
    // moveBefore preserves the warmed iframe's browsing context. appendChild
    // would reload it and discard the verified disc and initialized WASM module.
    if(!parent||new URLSearchParams(location.search).get('presentation')==='bitmap')return;
    if(this.frame.parentElement!==parent){
      if(!parent.moveBefore)return;
      parent.moveBefore(this.frame,canvas);
    }
    this.surface=canvas;
    canvas.style.opacity='0';
    Object.assign(this.frame.style,{position:'absolute',pointerEvents:'none',transformOrigin:'top left'});
    this.frame.setAttribute('aria-hidden','true');
    const fit=()=>{
      const scale=Math.min(parent.clientWidth/960,parent.clientHeight/720);
      Object.assign(this.frame.style,{left:`${(parent.clientWidth-960*scale)/2}px`,top:`${(parent.clientHeight-720*scale)/2}px`,transform:`scale(${scale})`});
    };
    this.resize=new ResizeObserver(fit);this.resize.observe(parent);fit();
    this.postMessage({type:'surface',direct:true});
  }
  postMessage(data: unknown){
    if(this.closed)return;
    if(!this.connected){this.pending.push(data);return;}
    const message=data as {type?:string;values?:number[];audio?:SharedArrayBuffer};
    if(message.type==='start'&&message.audio){
      // Safari can deep-copy SABs in window.postMessage. This same-origin
      // reference keeps the producer and AudioWorklet on the identical ring.
      (this.frame.contentWindow as Window & {openSmashAudioRing?:SharedArrayBuffer}).openSmashAudioRing=message.audio;
    }
    if(message?.type==='pad'&&Array.isArray(message.values)){
      const values=message.values,previous=this.pads.get(values[0]);
      // The engine reapplies held state every VI. Only changes need a browser
      // task; repeated neutral CPU ports otherwise dominate bridge traffic.
      if(previous&&previous.length===values.length&&values.every((value,i)=>value===previous[i]))return;
      this.pads.set(values[0],values.slice());
    }else if(['select','confirm','input'].includes(message?.type||''))this.pads.clear();
    this.frame.contentWindow?.postMessage(data,location.origin);
  }
  terminate(){if(this.closed)return;this.closed=true;clearTimeout(this.bridgeTimer);window.removeEventListener('message',this.listener);this.resize?.disconnect();if(this.surface)this.surface.style.opacity='';this.frame.remove();this.pending=[];}
}
