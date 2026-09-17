/** Worker-compatible launcher adapter for browser-owned WebGPU rendering. */
export class MeleeFrameWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  frame: HTMLIFrameElement;
  pending: unknown[];
  listener: (event: MessageEvent) => void;
  private pads = new Map<number, number[]>();
  connected = false;
  closed = false;
  resize?: ResizeObserver;
  surface?: HTMLCanvasElement;
  constructor(url: string) {
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
        this.connected=true;for(const data of this.pending)this.postMessage(data);this.pending=[];return;
      }
      const message=new MessageEvent('message',{data:event.data});
      this.dispatchEvent(message);this.onmessage?.(message);
    };
    window.addEventListener('message',this.listener);
    this.frame.src=url;
    document.body.append(this.frame);
  }
  attachSurface(canvas: HTMLCanvasElement){
    const parent=canvas.parentElement as (HTMLElement & {moveBefore?: (node:Node,child:Node|null)=>void})|null;
    // moveBefore preserves the warmed iframe's browsing context. appendChild
    // would reload it and discard the verified disc and initialized WASM module.
    if(!parent?.moveBefore||new URLSearchParams(location.search).get('presentation')==='bitmap')return;
    parent.moveBefore(this.frame,canvas);
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
    const message=data as {type?:string;values?:number[]};
    if(message?.type==='pad'&&Array.isArray(message.values)){
      const values=message.values,previous=this.pads.get(values[0]);
      // The engine reapplies held state every VI. Only changes need a browser
      // task; repeated neutral CPU ports otherwise dominate bridge traffic.
      if(previous&&previous.length===values.length&&values.every((value,i)=>value===previous[i]))return;
      this.pads.set(values[0],values.slice());
    }else if(['select','confirm','input'].includes(message?.type||''))this.pads.clear();
    this.frame.contentWindow?.postMessage(data,location.origin);
  }
  terminate(){if(this.closed)return;this.closed=true;window.removeEventListener('message',this.listener);this.resize?.disconnect();if(this.surface)this.surface.style.opacity='';this.frame.remove();this.pending=[];}
}
