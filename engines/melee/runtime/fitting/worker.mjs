import createFit from './fit.mjs';
import {fitCharacter} from './native-fit.mjs';
import {buildCostume} from './costume.mjs';
const moduleReady=createFit();
self.onmessage=async ({data})=>{
  try {
    const {character,target:slug,color}=data;
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(character)||!/^[a-z][a-z-]{0,31}$/.test(slug))throw Error('Invalid fighter or moveset.');
    const start=performance.now();
    const get=async (path,json=false)=>{const response=await fetch(new URL('assets/'+path,import.meta.url));if(!response.ok)throw Error('Character fitting assets are unavailable.');return json?response.json():response.arrayBuffer();};
    if(!Number.isInteger(color)||color<0||color>5)throw Error('Invalid costume slot');
    const sourceGet=async(suffix,json=false)=>{
      if(!data.sourceBase)throw Error('Missing character source package');
      const url=new URL(data.sourceBase+suffix,location.origin);
      if(url.origin!==location.origin||!/^\/(?:melee\/)?api\/native-fit\/assets\/[a-f0-9]{64}\/sources\/[a-z0-9_-]+\.(?:json|rgba8|identity\.dat)$/.test(url.pathname))throw Error('Invalid character source');
      const response=await fetch(url);if(!response.ok)throw Error('The character’s model could not load. Please try again.');
      return json?response.json():response.arrayBuffer();
    };
    const [module,source,rig,template,texture,identity]=await Promise.all([moduleReady,sourceGet('.json',true),get('targets/'+slug+'.json',true),get('targets/'+slug+'-'+color+'.dat'),sourceGet('.rgba8'),sourceGet('.identity.dat')]);
    if(!rig.layouts?.[color])throw Error('Character fitting assets are incomplete for this costume slot.');
    const target={...rig,...rig.layouts[color]};
    if(source.version!==1||target.version!==1)throw Error('Unsupported native fitting asset version');
    const loaded=performance.now();
    const input={...source,...target,origins:target.mode==='round'?source.roundOrigins:source.humanoidOrigins,normals:target.mode==='round'?source.normals:source.smoothNormals};
    const fitted=fitCharacter(module,input),fitDone=performance.now();
    const bytes=buildCostume(template,source,target,fitted,texture,color,identity);
    self.postMessage({filename:target.slots[color].filename,bytes,metrics:{character,target:slug,loadMs:loaded-start,fitMs:fitDone-loaded,packMs:performance.now()-fitDone,totalMs:performance.now()-start}},[bytes]);
  }catch(error){self.postMessage({error:error.message||String(error)});}
};
