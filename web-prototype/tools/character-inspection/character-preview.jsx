import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../visual/site-shell.css';
import '../../src/styles.css';
import FighterJobModal from '../../src/FighterJobModal.jsx';
function Preview() {
 const [open,setOpen]=useState(true);
 const [job,setJob]=useState({id:'local-download-preview',slug:'thomasdimson',name:'Thomas Dimson',status:'complete',character:{name:'Thomas Dimson',base:'mario',bundleUrl:'/tools/character-inspection/assets/thomasdimson.osb6'},artifacts:{targets:['mario','samus']}});
 return <><button onClick={()=>setOpen(true)}>Open Thomas download preview</button><FighterJobModal job={job} open={open} onClose={()=>setOpen(false)} onDelete={async()=>{}} onSaveSettings={async(_,base)=>setJob(current=>({...current,character:{...current.character,base}}))}/></>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
