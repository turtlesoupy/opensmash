/** Worker-compatible launcher adapter for browser-owned WebGPU rendering. */
export class MeleeFrameWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  frame: HTMLIFrameElement;
  pending: unknown[];
  listener: (event: MessageEvent) => void;
  connected = false;
  closed = false;
  constructor(url: string) {
    super();
    this.frame = document.createElement('iframe');
    this.frame.title = 'Melee engine';
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
  postMessage(data: unknown){if(this.closed)return;if(!this.connected){this.pending.push(data);return;}this.frame.contentWindow?.postMessage(data,location.origin);}
  terminate(){if(this.closed)return;this.closed=true;window.removeEventListener('message',this.listener);this.frame.remove();this.pending=[];}
}
