import http from 'node:http';
import https from 'node:https';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

// The imported server owns local game data and converters. Only development may
// proxy to it. A public deployment needs a separately authenticated asset service.
export function createMeleeHandler({origin=process.env.MELEE_LOCAL_ORIGIN,production=process.env.NODE_ENV==='production',serviceOrigin=process.env.MELEE_SERVICE_ORIGIN,serviceToken=process.env.MELEE_SERVICE_TOKEN}={}) {
  let upstream,hosted=false;
  if(serviceOrigin){
    upstream=new URL(serviceOrigin);hosted=true;
    if((upstream.protocol!=='https:'&&!(upstream.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(upstream.hostname)))||upstream.username||upstream.password||upstream.pathname!=='/'||upstream.search||upstream.hash||!serviceToken||serviceToken.length<32)throw Error('Configure a private Melee service origin and a token of at least 32 characters.');
    if(origin)throw Error('Choose the hosted or local Melee service, not both.');
  }
  if(origin){
    upstream=new URL(origin);
    if(production || upstream.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(upstream.hostname)
      || upstream.username || upstream.password || upstream.pathname!=='/' || upstream.search || upstream.hash)
      throw Error('MELEE_LOCAL_ORIGIN must be a loopback HTTP origin in development.');
  }
  return function handleMelee(req,res,{user}={}){
    const url=new URL(req.url,'http://localhost');
    if(!/^\/melee\/(api|engine)\//.test(url.pathname))return false;
    if(!upstream){
      const body=JSON.stringify({error:'Melee assets are not configured on this server.'});
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);return true;
    }
    if(hosted&&!allowedHostedRoute(req.method,url.pathname.slice('/melee'.length))){res.writeHead(404);res.end();return true;}
    // Engine runtime files are public and content-addressed: let the origin's
    // cache policy through and never attach a per-visitor cookie to them, or
    // neither browsers nor the CDN could cache them.
    const cacheable=['GET','HEAD'].includes(req.method)&&url.pathname.startsWith('/melee/engine/');
    const headers={...req.headers,host:upstream.host};
    // The browser is talking to this same-origin development server. Never
    // forward website credentials into the local game service.
    delete headers.cookie;delete headers.authorization;delete headers['x-opensmash-token'];delete headers['x-opensmash-owner'];
    if(headers.origin){
      if(headers.origin!==`http://${req.headers.host}` && headers.origin!==`https://${req.headers.host}`){res.writeHead(403);res.end();return true;}
      headers.origin=upstream.origin;
    }
    if(hosted){
      let identity=user?.uid;
      if(!identity){
        const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)opensmash-melee-client=([a-f0-9]{48})\.([a-f0-9]{64})(?:;|$)/);
        const sign=value=>createHmac('sha256',serviceToken).update(value).digest('hex');
        let guest=cookie&&timingSafeEqual(Buffer.from(cookie[2],'hex'),Buffer.from(sign(cookie[1]),'hex'))?cookie[1]:null;
        if(!guest){guest=randomBytes(24).toString('hex');if(!cacheable)res.setHeader('Set-Cookie',`opensmash-melee-client=${guest}.${sign(guest)}; Path=/melee; HttpOnly; SameSite=Lax${production?'; Secure':''}`);}
        identity='guest:'+guest;
      }
      headers['x-opensmash-token']=serviceToken;
      headers['x-opensmash-owner']=createHash('sha256').update(identity).digest('hex');
    }
    const proxy=(upstream.protocol==='https:'?https:http).request(new URL(url.pathname.slice('/melee'.length)+url.search,upstream),{method:req.method,headers}, response=>{
      const output={...response.headers,'Cross-Origin-Resource-Policy':'same-origin','Cache-Control':cacheable&&response.statusCode===200?response.headers['cache-control']||'no-store':'no-store'};delete output['set-cookie'];res.writeHead(response.statusCode,output);
      response.pipe(res);
    });
    proxy.setTimeout(120000,()=>proxy.destroy(Error('Melee service timed out')));
    proxy.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The Melee service is unavailable.'}));}else res.destroy();});
    req.on('aborted',()=>proxy.destroy());res.on('close',()=>{if(!res.writableEnded)proxy.destroy();});
    req.pipe(proxy);return true;
  };
}

export function allowedHostedRoute(method,path){
 if(method==='GET'||method==='HEAD')return /^\/engine\/[a-zA-Z0-9_.\/-]+$/.test(path)||/^\/api\/(?:costume|announcer)\/[a-zA-Z0-9_-]+$/.test(path)||/^\/api\/imports(?:\/[a-f0-9]+|\/portraits\/import-[a-f0-9]{24}\.webp)?$/.test(path)||/^\/api\/character-select\/[a-f0-9]{64}\/[0-3]\.bin$/.test(path);
 return method==='POST'&&(path==='/api/imports'||path==='/api/character-select'||/^\/api\/prepare\/[a-zA-Z0-9_-]+$/.test(path));
}
