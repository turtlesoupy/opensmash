import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createMeleeHandler} from './handler.mjs';

// One lazy child in the web container. Concurrent first requests share startup;
// conversion/cache behavior remains in the existing Python implementation.
export function createEmbeddedMeleeHandler({env=process.env,spawnProcess=spawn}={}) {
  if(env.MELEE_EMBEDDED!=='1')return createMeleeHandler();
  if(env.MELEE_SERVICE_ORIGIN||env.MELEE_LOCAL_ORIGIN)throw Error('Embedded Melee cannot also use an external service.');
  if(!env.COOKIE_SECRET)throw Error('Embedded Melee needs the website COOKIE_SECRET.');
  const token=createHmac('sha256',env.COOKIE_SECRET).update('opensmash-melee-gateway-v1').digest('hex');
  let child,starting,proxy;
  const stop=()=>child?.kill('SIGTERM');
  process.once('exit',stop);
  async function start(){
    if(proxy)return;
    if(starting)return starting;
    starting=new Promise((resolve,reject)=>{
      const worker=spawnProcess(env.MELEE_PYTHON||'python3',[
        fileURLToPath(new URL('../tools/serve_embedded.py',import.meta.url)),
      ],{env:{...env,MELEE_SERVICE_TOKEN:token,PYTHONUNBUFFERED:'1'},stdio:['ignore','pipe','inherit']});
      child=worker;let output='',ready=false;
      const timer=setTimeout(()=>{worker.kill('SIGTERM');reject(Error('Melee startup timed out'));},120000);
      worker.stdout.on('data',chunk=>{
        output+=chunk.toString();
        let newline;
        while((newline=output.indexOf('\n'))>=0){
          const line=output.slice(0,newline);output=output.slice(newline+1);
          const match=/^MELEE_READY (\d+)$/.exec(line);
          if(match&&!ready){
            proxy=createMeleeHandler({origin:null,production:env.NODE_ENV==='production',serviceOrigin:`http://127.0.0.1:${match[1]}`,serviceToken:token});
            ready=true;clearTimeout(timer);resolve();
          }else console.log('[melee]',line);
        }
      });
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',()=>{clearTimeout(timer);if(child===worker){child=null;proxy=null;starting=null;}if(!ready)reject(Error('Melee preparation could not start'));});
    });
    try{await starting;}catch(error){starting=null;throw error;}
  }
  const handle=function(req,res,context){
    if(!/^\/melee\/(api|engine)\//.test(req.url))return false;
    void start().then(()=>{if(!res.destroyed)proxy(req,res,context);}).catch(error=>{
      console.error('[melee]',error.message);
      if(!res.destroyed&&!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Melee is temporarily unavailable. Please retry.'}));}
    });
    return true;
  };
  handle.close=()=>{stop();process.removeListener('exit',stop);};
  return handle;
}
