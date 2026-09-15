/* Headed browser integration check. ISO stays in the browser's local filesystem.
 * NODE_PATH=/path/to/node_modules node tools/validate_vs_intro.cjs ISO OUTPUT [2|4]
 */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const iso=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),players=Number(process.argv[4]||2);
 assert([2,4].includes(players));fs.mkdirSync(output,{recursive:true});
 const events=[],errors=[];
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{channel:'chrome',headless:false,viewport:{width:1200,height:900},ignoreDefaultArgs:['--mute-audio']});
 const page=context.pages()[0];
 await page.exposeFunction('recordIntroEvent',data=>{events.push(data);if(data.type==='log'&&/intro|combat started/.test(data.text))console.log(data.text);});
 await page.addInitScript(players=>{
  const Base=window.Worker;window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(!['frame','metrics','pad'].includes(data.type))window.recordIntroEvent(data);});}};
  const names=players===4?['alanturing','abrahamlincoln','stevejobs','50cent']:['vanilla:6','vanilla:16'];
  const targets=['mario','fox','mario','mario'];
  localStorage.setItem('melee-launch-v1',JSON.stringify({mode:0,stage:28,level:9,stocks:4,minutes:8,ports:Array.from({length:4},(_,i)=>({device:i>=players?'off':i?'cpu':'keyboard',character:names[i]||'vanilla:8',target:players===4?targets[i]:'auto'}))}));
 },players);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/game{,/**}',route=>{errors.push('Unexpected server disc access');return route.abort();});
 try{
  await page.goto(process.env.MELEE_TEST_URL||'http://127.0.0.1:5174/?benchmark=1');await page.bringToFront();
  await page.getByLabel('Choose Melee ISO, GCM or ZIP').setInputFiles(iso);
  await page.waitForFunction(()=>document.querySelector('.boot-disc [role="status"]')?.textContent==='Ready to play.',null,{timeout:120000});
  await page.getByRole('button',{name:/^Play as Alan Turing, .* moveset$/}).click();
  let captured=false,combat=false;
  for(const deadline=Date.now()+240000;Date.now()<deadline;){
   await page.waitForTimeout(250);
   const failure=events.find(e=>e.type==='error');if(failure)throw Error(failure.message);
   if(events.some(e=>e.type==='intro')){
    if(!captured&&events.some(e=>e.type==='log'&&e.text.includes('intro announcer'))){await page.screenshot({path:path.join(output,'intro.png')});captured=true;}
   }else if(!events.some(e=>e.type==='log'&&e.text.includes('intro preparing')))await page.getByRole('button',{name:'Confirm · A',exact:true}).click();
   if(events.some(e=>e.type==='playable')){combat=true;await page.waitForTimeout(3000);await page.screenshot({path:path.join(output,'combat.png')});break;}
  }
  assert(captured,'Intro was not displayed');assert(combat,'Combat did not begin');
  const cues=events.filter(e=>e.type==='log'&&e.text.includes('intro announcer port='));
  assert.equal(cues.length,players,'Every active port should be announced exactly once');
  const versus=events.findIndex(e=>e.type==='log'&&e.text.includes('intro versus'));
  assert(versus>events.indexOf(cues[0])&&versus<events.indexOf(cues[1]),'Versus must follow the first name');
  if(players===4){
   assert(cues.every(e=>!/sample=0$/.test(e.text)),'Custom announcer samples were missing');
   const mixed=events.filter(e=>e.type==='log'&&e.text.includes('intro custom voice sample='));
   assert.equal(mixed.length,players,'Every custom name must reach the audio mixer');
   assert.deepEqual(mixed.map(e=>e.text.split('sample=')[1]),cues.map(e=>e.text.split('sample=')[1]));
  }
  assert(events.some(e=>e.type==='log'&&e.text.includes('intro restored VS match')));
  assert.deepEqual(errors,[]);
  console.log('Intro, per-port announcements and combat transition passed.');
 }finally{fs.writeFileSync(path.join(output,'events.json'),JSON.stringify(events,null,2));fs.writeFileSync(path.join(output,'errors.json'),JSON.stringify(errors,null,2));await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
