// Only the website's Firebase handler may open an in-app authentication window.
// It shares web cookies, but must never inherit the native engine preload.
function popupPolicy(raw,site){
 try{
  const url=new URL(raw);
  if(url.origin===site&&url.pathname==='/__/auth/handler')return {
   action:'allow',overrideBrowserWindowOptions:{width:520,height:720,autoHideMenuBar:true,
    webPreferences:{preload:'',additionalArguments:[],sandbox:true,contextIsolation:true,nodeIntegration:false}},
  };
 }catch{}
 return {action:'deny'};
}
module.exports={popupPolicy};
