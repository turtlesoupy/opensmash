/** Poll without overlapping requests; transient failures and an older session
 * must not strand setup or a launch. Disposal also aborts the in-flight request. */
export function pollService<T>(url:string, onStatus:(status:T)=>void, onError:(error:Error)=>void, interval=500){
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>;
 async function poll(){
  try{
   const response=await fetch(url,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error(`Game service unavailable (${response.status}).`);
   const status=await response.json();
   if(!controller.signal.aborted)onStatus(status);
  }catch(error){if(!controller.signal.aborted)onError(error as Error);}
  finally{if(!controller.signal.aborted)timer=setTimeout(poll,interval);}
 }
 void poll();
 return()=>{controller.abort();clearTimeout(timer);};
}
