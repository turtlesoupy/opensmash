const fs = require('node:fs/promises');
const path = require('node:path');

const PAGES=new Set(['/','/melee','/melee/','/create','/create/','/trailer','/trailer/','/og-studio','/og-studio/','/index.html']);
const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.gstatic.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https:; connect-src 'self' blob: https: wss:; worker-src 'self' blob:; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary'};

// The desktop bundles the frontend while retaining the website origin for
// authentication and hosted services. Engine requests stay in the local backend;
// its private token is never sent to the website or renderer.
function createSiteHandler({dist,backend,token,site='https://smash.fun',fetchRemote}) {
 const siteOrigin=new URL(site).origin,root=path.resolve(dist);
 return async request=>{
  const url=new URL(request.url);
  if(url.origin!==siteOrigin){
   // Electron's protocol forwarding loses the embed initiator. YouTube needs
   // the website origin as Referer to identify the player (otherwise error 153).
   if(['https://www.youtube-nocookie.com','https://www.youtube.com'].includes(url.origin)&&url.pathname.startsWith('/embed/')){
    const headers=new Headers(request.headers);headers.set('Referer',siteOrigin+'/');
    return fetchRemote(new Request(request,{headers}));
   }
   return fetchRemote(request);
  }
  if(/^\/melee\/(api|engine)\//.test(url.pathname)){
   const headers=new Headers(request.headers);
   headers.delete('cookie');headers.delete('authorization');headers.delete('origin');
   headers.set('X-OpenSmash-Token',token);
   const response=await fetch(new URL(url.pathname.slice('/melee'.length)+url.search,backend),{
    method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),signal:request.signal,
   });
   const output=new Headers(response.headers);output.set('Cross-Origin-Resource-Policy','same-origin');output.delete('set-cookie');
   return new Response(response.body,{status:response.status,headers:output});
  }
  const page=PAGES.has(url.pathname);
  if(page||url.pathname.startsWith('/app-assets/')||['/controller-remap.js','/manifest.webmanifest','/favicon.ico','/favicon-16.png','/apple-touch-icon.png'].includes(url.pathname)){
   if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
   const relative=page?'index.html':decodeURIComponent(url.pathname).slice(1);
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep))return new Response('Not found',{status:404});
   let body;
   try{body=await fs.readFile(file);}catch{return new Response('Bundled launcher asset missing. Reinstall the client.',{status:404});}
   const headers={'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','Cross-Origin-Resource-Policy':'same-origin'};
   if(page)headers['Content-Security-Policy']=CSP;
   // Native engines do not need browser shared memory. Keep OAuth popups
   // and the website's trailer available on either experience.
   if(page)headers['Cross-Origin-Opener-Policy']='same-origin-allow-popups';
   return new Response(request.method==='HEAD'?null:body,{headers});
  }
  // Browser services own their authentication and cookies. Forward the request
  // unchanged; no native credentials or local file paths are included.
  return fetchRemote(request);
 };
}
module.exports={createSiteHandler};
